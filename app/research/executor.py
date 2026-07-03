"""Research executor: walk a Plan against Numa's data modules and synthesize.

An async generator (:func:`run_plan`) steps through a plan's subtasks **in
order**, reusing the analyze endpoints' pattern exactly: the base
``yf.Ticker(...)`` / ``.info`` is fetched **once per ticker** and handed to the
same ``MODULE_REGISTRY`` signature adapters the analyze endpoints use, so a fetch
subtask named ``technicals`` runs precisely what ``/analyze`` runs.

Subtask dispatch by tool (resolved from the subtask ``name`` — see
:func:`resolve_tool`):

* a **fetch tool** (a MODULE_REGISTRY key) → the matching ``get_*`` module, run
  for every ticker → ``{ticker: <module bag>}``.
* ``macro`` → the shared :func:`get_macro` (no ticker).
* ``reason`` → a Claude call whose context is the outputs of the subtask's
  ``depends_on`` (no fetch).

After the subtasks, one **streaming** synthesis call turns everything into prose.

Events yielded (each a dict with a ``type``):

    plan | subtask_started | subtask_completed | synthesis_token | complete | error

A subtask that raises does **not** abort the run: its ``subtask_completed`` event
carries an error bag (``{"error": ...}``) as its data and the walk continues. The
top-level ``error`` event is reserved for a fatal run-level failure.
"""

import json
import re

from app.config import (
    ANTHROPIC_CLIENT,
    RESEARCH_VALIDATOR_MODEL,
    estimate_cost_usd,
    logger,
)
from app.research import validator
from app.research.router import route_model
from app.research.schemas import (
    KIND_FETCH,
    KIND_REASON,
    KIND_SYNTHESIS,
    Plan,
    coerce_kind,
    render_plan,
)
from app.routes.analyze import MODULE_REGISTRY, Ctx
from app.routes.macro import get_macro
from app.utils import _json_safe

# --- Tool catalog — derived once from the analyze registry -------------------
# The subtask tool menu is exactly MODULE_REGISTRY keys + "macro" + "reason"
# (RESEARCH_PLAN.md). The planner advertises ALLOWED_TOOLS; the executor
# dispatches on it. Kept here (not in the planner) so both sides agree.
SPEC_BY_KEY = {spec.key: spec for spec in MODULE_REGISTRY}
REASON_TOOL = "reason"
MACRO_TOOL = "macro"
FETCH_TOOLS = set(SPEC_BY_KEY) | {MACRO_TOOL}
ALLOWED_TOOLS = sorted(FETCH_TOOLS | {REASON_TOOL})

# Cap on how much prior-output JSON is fed into a reason/synthesis prompt, so a
# fat options/technicals bag can't blow the context window or the bill.
_CONTEXT_CHARS = 6000


class UsageAccumulator:
    """Sums token usage across every Claude call in a run (planner, reason steps,
    synthesis), per model, so the run can emit one 'usage' event with an
    estimated USD cost. Shared by the planner (seed) and executor."""

    def __init__(self):
        self.by_model = {}  # model -> [input_tokens, output_tokens]

    def add(self, model: str, usage) -> None:
        """Fold in one call's ``usage`` (an object with input_tokens/output_tokens,
        e.g. Anthropic's resp.usage or stream.get_final_message().usage)."""
        if usage is None:
            return
        it = int(getattr(usage, "input_tokens", 0) or 0)
        ot = int(getattr(usage, "output_tokens", 0) or 0)
        slot = self.by_model.setdefault(model, [0, 0])
        slot[0] += it
        slot[1] += ot

    @property
    def input_tokens(self) -> int:
        return sum(v[0] for v in self.by_model.values())

    @property
    def output_tokens(self) -> int:
        return sum(v[1] for v in self.by_model.values())

    def cost_usd(self) -> float:
        return round(sum(estimate_cost_usd(m, i, o) for m, (i, o) in self.by_model.items()), 4)

    def event(self) -> dict:
        return {"type": "usage", "input_tokens": self.input_tokens,
                "output_tokens": self.output_tokens, "cost_usd": self.cost_usd()}


def resolve_tool(name: str) -> str:
    """Map a subtask ``name`` to the tool that runs it.

    Normalizes case/spacing and strips a trailing numeric suffix (so ``reason``
    and ``reason_2`` both resolve to ``reason``, letting a plan reuse a tool
    while keeping unique names for ``depends_on``). Anything that isn't a known
    fetch tool falls back to ``reason`` — the free-form Claude step.
    """
    norm = re.sub(r"[\s\-]+", "_", (name or "").strip().lower())
    norm = re.sub(r"_?\d+$", "", norm)
    return norm if norm in FETCH_TOOLS else REASON_TOOL


def effective_kind(st) -> str:
    """The kind that actually governs a subtask's routing & cost, reconciling its
    emitted ``kind`` with the tool its ``name`` resolves to. A fetch tool is
    always ``fetch`` (it runs a data module, no LLM) regardless of any emitted
    kind; a reason tool is ``reason`` unless the planner explicitly marked it
    ``synthesis`` (routing that step to the larger synthesis model). ``st`` is a
    Subtask (or anything with ``.name``/``.kind``). This is the single source both
    the executor's dispatch and the cost estimator route on, so they can't drift.
    """
    if resolve_tool(getattr(st, "name", "")) != REASON_TOOL:
        return KIND_FETCH
    k = coerce_kind(getattr(st, "kind", None))
    return KIND_REASON if k == KIND_FETCH else k


def _default_stock_factory(ticker: str):
    """Fetch (stock, info) the way the analyze endpoints do. Injectable so tests
    can hand in the recorded FakeTicker instead of hitting the network."""
    import yfinance as yf

    stock = yf.Ticker(ticker)
    return stock, stock.info


def _build_ctx(ticker: str, mode: str, stock_factory) -> Ctx:
    stock, info = stock_factory(ticker)
    info = info or {}
    current_price = info.get("currentPrice") or info.get("regularMarketPrice") or 100.0
    return Ctx(stock=stock, info=info, ticker=ticker, mode=mode, current_price=current_price)


def _run_fetch(tool: str, tickers, ctxs: dict) -> dict:
    """Run a fetch tool. ``macro`` is ticker-agnostic; every other fetch tool
    runs once per ticker and returns ``{ticker: <module bag>}`` (a per-ticker
    module failure degrades to that ticker's error bag, not the whole subtask)."""
    if tool == MACRO_TOOL:
        return {"macro": get_macro()}
    spec = SPEC_BY_KEY[tool]
    out = {}
    for t in tickers:
        try:
            out[t] = spec.fetch(ctxs[t])
        except Exception as e:  # a module adapter blew up for this ticker only
            out[t] = {"error": str(e)}
    return out


def _reason(client, description: str, context: dict, model: str):
    """Free-form Claude step over the outputs of a subtask's depends_on, on the
    router-chosen ``model``. Returns ``(bag, usage)`` so the caller can accumulate
    token usage against that same model."""
    system = (
        "You are a senior equity research analyst working one step of a larger "
        "research plan. Reason over the provided data to satisfy the step's "
        "objective. Be specific and use numbers from the data; do not fabricate "
        "figures that are not present. Return prose, no code fences."
    )
    ctx_json = json.dumps(context, default=str)[:_CONTEXT_CHARS] if context else "(no prior data)"
    user_msg = f"Step objective:\n{description}\n\nData from prior steps:\n{ctx_json}"
    resp = client.messages.create(
        model=model,
        max_tokens=700,
        system=system,
        messages=[{"role": "user", "content": user_msg}],
    )
    return {"reasoning": resp.content[0].text.strip()}, getattr(resp, "usage", None)


async def run_plan(
    plan: Plan,
    tickers,
    *,
    objective: str = "",
    mode: str = "free",
    client=None,
    stock_factory=None,
    usage=None,
):
    """Async generator: execute ``plan`` over ``tickers``, yielding typed events.

    ``client`` (Anthropic) and ``stock_factory`` are injectable for offline
    tests; they default to the shared client and a live ``yf.Ticker`` fetch.
    ``usage`` is an optional pre-seeded :class:`UsageAccumulator` (e.g. carrying
    the planner call's tokens for a chat auto-run); reason + synthesis usage is
    folded in and a final ``usage`` event is emitted before ``complete``.
    """
    client = client or ANTHROPIC_CLIENT
    stock_factory = stock_factory or _default_stock_factory
    usage = usage if usage is not None else UsageAccumulator()
    tickers = [t.upper().strip() for t in (tickers or []) if t and t.strip()]

    # Run-time resolver: fill {ticker} in step descriptions so the reason /
    # synthesis prompts (and the emitted plan) carry the concrete symbol, not the
    # template placeholder — independent of any client-side substitution.
    if tickers:
        plan = render_plan(plan, ", ".join(tickers))

    yield {"type": "plan", "objective": objective, "tickers": tickers,
           "plan": plan.model_dump()}

    try:
        # Base fetch, once per ticker — mirrors analyze()/analyze_stream().
        ctxs = {t: _build_ctx(t, mode, stock_factory) for t in tickers}
    except Exception as e:
        yield {"type": "error", "error": f"failed to load ticker data: {e}"}
        return

    outputs: dict = {}  # subtask name -> its result bag (for depends_on / synthesis)

    for st in plan.subtasks:
        tool = resolve_tool(st.name)
        yield {"type": "subtask_started", "name": st.name, "tool": tool,
               "description": st.description, "depends_on": list(st.depends_on)}
        try:
            if tool == REASON_TOOL:
                model = route_model(effective_kind(st), st.model_override)
                context = {dep: outputs[dep] for dep in st.depends_on if dep in outputs}
                data, reason_usage = _reason(client, st.description, context, model)
                usage.add(model, reason_usage)
            else:
                data = _run_fetch(tool, tickers, ctxs)
        except Exception as e:  # per-subtask failure: report, don't abort
            logger.debug("research subtask %r failed", st.name, exc_info=e)
            data = {"error": str(e)}
        data = _json_safe(data)
        outputs[st.name] = data
        yield {"type": "subtask_completed", "name": st.name, "tool": tool, "data": data}

    # ── Final synthesis — streams tokens ────────────────────────────────
    system = (
        "You are a senior equity research analyst. Synthesize the research "
        "below into a concise, investment-grade note that directly answers "
        "the objective. Use specific numbers from the data; never fabricate "
        "figures. No generic disclaimers."
    )
    synth_user = (
        f"Objective: {objective or '(none stated)'}\n"
        f"Tickers: {', '.join(tickers) or '(none)'}\n\n"
        f"Findings:\n{json.dumps(outputs, default=str)[:_CONTEXT_CHARS * 2]}"
    )
    synth_model = route_model(KIND_SYNTHESIS)  # the implicit final synthesis step
    full = ""
    try:
        with client.messages.stream(
            model=synth_model,
            max_tokens=1200,
            system=system,
            messages=[{"role": "user", "content": synth_user}],
        ) as stream:
            for text in stream.text_stream:
                full += text
                yield {"type": "synthesis_token", "token": text}
            usage.add(synth_model, getattr(stream.get_final_message(), "usage", None))
    except Exception as e:
        yield {"type": "error", "error": f"synthesis failed: {e}"}
        return

    # ── Validate the memo; retry synthesis ONCE on a failing score ───────
    # Fail-open (see validator): a killed/failed grader passes at 10, so a run is
    # never blocked. When scoring is enabled we emit a 'validation' event (before
    # 'usage') so the frontend can badge the memo; validator + retry tokens fold
    # into `usage` so the displayed cost covers them.
    if validator.enabled():
        verdict, val_usage = validator.validate(objective, full, outputs, client=client)
        usage.add(RESEARCH_VALIDATOR_MODEL, val_usage)
        retried = False
        if not verdict["ok"]:
            retried = True
            fix = verdict["feedback"] or "; ".join(verdict["issues"]) or "Be more specific and numeric."
            revision = (
                f"{synth_user}\n\n"
                f"REVISION REQUIRED — a reviewer scored your previous draft "
                f"{verdict['score']}/10, below the bar. Fix this and rewrite the "
                f"note in full:\n{fix}\n"
                "Stay grounded in the findings above; never fabricate figures."
            )
            try:
                resp = client.messages.create(
                    model=synth_model, max_tokens=1200, system=system,
                    messages=[{"role": "user", "content": revision}],
                )
                revised = (resp.content[0].text or "").strip()
                if revised:
                    full = revised  # the second draft ships regardless of its own quality
                usage.add(synth_model, getattr(resp, "usage", None))
            except Exception as e:  # retry failed → keep the first draft
                logger.debug("synthesis retry failed, keeping first draft: %s", e)
        yield {"type": "validation", "score": verdict["score"], "ok": verdict["ok"],
               "retried": retried, "issues": verdict["issues"]}

    yield usage.event()
    yield {"type": "complete", "synthesis": full, "outputs": outputs}
