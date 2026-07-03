"""Pre-run cost projection for a research plan — pure math, no LLM call.

Ported from the agentic-orchestrator's cost mechanism. Given a plan and the run
objective, project a USD cost per step and for the run as a whole, so the UI can
show the bill *before* anything is spent. This is a static estimate from string
lengths and the list-price table — not a token count of any real call.

Per step (see the task spec):

    input_tokens  = (len(objective) + len(description)
                     + sum(len(dep description) for each depends_on)) // 4 + 500
    output_tokens = clamp(input_tokens * 1.75, 200, config max)
    usd           = (input*price_in + output*price_out) / 1e6   [estimate_cost_usd]

A **fetch** step runs a data module — no LLM — so it is free ($0, zero tokens).
The step's model comes from the same router the executor uses (so the projection
and the real run agree), and it is priced from the same per-million table. The
run total is the sum of the plan's steps (``agents_usd``) plus the implicit final
synthesis step (``synthesis_usd``).
"""

from app import config
from app.config import estimate_cost_usd
from app.research.executor import effective_kind
from app.research.router import route_model
from app.research.schemas import KIND_SYNTHESIS, Plan

# Estimate constants (the spec's fixed factors).
_OVERHEAD_TOKENS = 500      # per-step prompt scaffold on top of the char estimate
_OUTPUT_RATIO = 1.75        # projected output tokens as a multiple of input
_MIN_OUTPUT_TOKENS = 200    # floor: even a terse step emits a little

# Friendly labels for the cost pill, derived from the tier aliases so they never
# drift from config; an unmapped (custom-env) model id shows verbatim.
_MODEL_LABELS = {mid: alias.capitalize() for alias, mid in config.MODEL_ALIASES.items()}


def model_label(model) -> str:
    """A short human label for a routed model id; ``—`` for a fetch step (no LLM)."""
    if not model:
        return "—"
    return _MODEL_LABELS.get(model, model)


def _tokens(objective: str, description: str, dep_descriptions) -> tuple:
    """(input_tokens, output_tokens) for a step, per the spec formula above."""
    chars = (
        len(objective or "")
        + len(description or "")
        + sum(len(d or "") for d in dep_descriptions)
    )
    inp = chars // 4 + _OVERHEAD_TOKENS
    out = int(min(max(inp * _OUTPUT_RATIO, _MIN_OUTPUT_TOKENS), config.RESEARCH_MAX_OUTPUT_TOKENS))
    return inp, out


def estimate_step(objective: str, description: str, dep_descriptions, model) -> dict:
    """Project one step's cost. A fetch step (``model is None``) is free: no
    tokens, $0. Returns ``{model, model_label, usd, input_tokens, output_tokens}``.
    """
    if model is None:
        return {"model": None, "model_label": model_label(None), "usd": 0.0,
                "input_tokens": 0, "output_tokens": 0}
    inp, out = _tokens(objective, description, dep_descriptions)
    return {"model": model, "model_label": model_label(model),
            "usd": estimate_cost_usd(model, inp, out),
            "input_tokens": inp, "output_tokens": out}


def estimate_plan(plan, objective: str = "") -> dict:
    """Per-step + total cost projection for ``plan`` run against ``objective``.

    Returns per-step ``{name, kind, model, model_label, usd, input_tokens,
    output_tokens}`` plus the implicit synthesis step and the run totals
    ``{agents_usd, synthesis_usd, total_usd}``. Accepts a :class:`Plan` or a raw
    plan dict; never raises on a malformed/empty plan (it just costs less).
    """
    objective = objective or ""
    subtasks = plan.subtasks if isinstance(plan, Plan) else Plan(**(plan or {})).subtasks
    by_name = {st.name: st for st in subtasks}

    steps = []
    for st in subtasks:
        kind = effective_kind(st)
        model = route_model(kind, st.model_override)
        dep_descs = [by_name[d].description for d in st.depends_on if d in by_name]
        est = estimate_step(objective, st.description, dep_descs, model)
        est["usd"] = round(est["usd"], 4)
        steps.append({"name": st.name, "kind": kind, **est})

    # The implicit final synthesis reads every step's output; approximate that by
    # feeding all step descriptions as its dependencies.
    synth_model = route_model(KIND_SYNTHESIS)
    synth = estimate_step(objective, "", [st.description for st in subtasks], synth_model)
    synth["usd"] = round(synth["usd"], 4)
    synthesis = {"name": "synthesis", "kind": KIND_SYNTHESIS, **synth}

    agents_usd = round(sum(s["usd"] for s in steps), 4)
    synthesis_usd = synthesis["usd"]
    return {
        "steps": steps,
        "synthesis": synthesis,
        "agents_usd": agents_usd,
        "synthesis_usd": synthesis_usd,
        "total_usd": round(agents_usd + synthesis_usd, 4),
    }
