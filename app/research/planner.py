"""Research planner: one Claude call that turns an objective into a Plan.

Behaviour follows AO's planner: ask the model for the verbatim plan JSON
(``{"subtasks": [{"name", "description", "depends_on": []}]}``) choosing subtask
names from the fixed tool menu (:data:`ALLOWED_TOOLS`), then **degrade
gracefully** — any malformed output or an empty subtask list collapses to a
single subtask restating the objective. Subtask counts are hard-capped
(``AUTO_MAX_SUBTASKS`` for auto/chat plans, ``SKILL_MAX_SUBTASKS`` for skills).

The model name comes from ``config.RESEARCH_PLANNER_MODEL`` — not hard-coded
here.
"""

import json
import re

from app.config import ANTHROPIC_CLIENT, RESEARCH_PLANNER_MODEL, logger
from app.research.executor import ALLOWED_TOOLS, FETCH_TOOLS, REASON_TOOL, resolve_tool
from app.research.schemas import Plan, Subtask

# Cost guards (RESEARCH_PLAN.md): auto-mode plans ≤ 5 subtasks, skill plans ≤ 8.
AUTO_MAX_SUBTASKS = 5
SKILL_MAX_SUBTASKS = 8


def _degraded_plan(objective: str) -> Plan:
    """AO's fallback: a single ``reason`` subtask that restates the objective."""
    return Plan(subtasks=[Subtask(
        name=REASON_TOOL,
        description=(objective or "").strip() or "Research the stated objective.",
        depends_on=[],
    )])


def _clean_subtasks(subtasks, max_subtasks) -> list:
    """Coerce a parsed ``subtasks`` array into validated Subtasks (dropping junk),
    capped at ``max_subtasks``. Shared by build_plan and propose_plan."""
    if not isinstance(subtasks, list):
        return []
    cleaned = []
    for st in subtasks:
        if not isinstance(st, dict):
            continue
        name = str(st.get("name", "")).strip()
        if not name:
            continue
        deps = st.get("depends_on", [])
        deps = [str(d) for d in deps] if isinstance(deps, list) else []
        cleaned.append(Subtask(name=name, description=str(st.get("description", "")), depends_on=deps))
    return cleaned[:max_subtasks]


def _cap_name(name: str) -> str:
    """Trim a skill name to ≤40 chars on a word boundary (no mid-word cut)."""
    name = (name or "").strip()
    if len(name) <= 40:
        return name
    cut = name[:40].rsplit(" ", 1)[0]
    return (cut or name[:40]).strip()


def _system_prompt() -> str:
    fetchers = ", ".join(sorted(FETCH_TOOLS))
    return (
        "You are the planner for a stock-research engine. Break the user's "
        "objective into an ordered list of subtasks and return ONLY minified "
        "JSON, no prose, no code fences, matching exactly:\n"
        '{"subtasks":[{"name":"<tool>","description":"<what this step does>",'
        '"depends_on":["<earlier subtask name>"]}]}\n\n'
        "Each subtask's \"name\" MUST be one of these tools:\n"
        f"  fetch tools (pull data for the ticker(s)): {fetchers}\n"
        f"  \"{REASON_TOOL}\": analyze/compare the outputs of earlier subtasks "
        "(no data fetch of its own).\n\n"
        "Rules: names must be unique — to reuse a tool, suffix a number "
        "(reason, reason_2). \"depends_on\" lists the names of earlier subtasks "
        "whose output this step needs (fetch tools usually have none). Prefer the "
        "fewest subtasks that answer the objective; end with a \"reason\" step "
        "that ties the findings together when the objective needs synthesis."
    )


def build_plan(objective, tickers=None, *, max_subtasks=AUTO_MAX_SUBTASKS, client=None) -> Plan:
    """Plan ``objective`` over ``tickers`` (one Claude call). Degrades to a
    single-subtask plan on malformed output or zero subtasks; always enforces the
    ``max_subtasks`` cap. Never raises — planning failure is a degraded plan."""
    client = client or ANTHROPIC_CLIENT
    objective = (objective or "").strip()
    tickers = [t.upper().strip() for t in (tickers or []) if t and t.strip()]

    if not client.api_key:
        return _degraded_plan(objective)

    user_msg = (
        f"Objective: {objective or '(none stated)'}\n"
        f"Tickers: {', '.join(tickers) or '(none)'}\n"
        f"Allowed tools: {', '.join(ALLOWED_TOOLS)}\n"
        f"Return at most {max_subtasks} subtasks."
    )
    try:
        resp = client.messages.create(
            model=RESEARCH_PLANNER_MODEL,
            max_tokens=800,
            system=_system_prompt(),
            messages=[{"role": "user", "content": user_msg}],
        )
        raw = resp.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1].lstrip("json").strip()
        parsed = json.loads(raw)
        subtasks = parsed.get("subtasks", []) if isinstance(parsed, dict) else []
    except Exception as e:
        logger.debug("planner parse failed, degrading: %s", e)
        return _degraded_plan(objective)

    cleaned = _clean_subtasks(subtasks, max_subtasks)
    if not cleaned:  # zero valid subtasks → degrade (AO behaviour)
        return _degraded_plan(objective)

    return Plan(subtasks=cleaned)


# ============================================================
# === PROPOSE — draft a reusable skill (invert-the-substitution) ===
# ============================================================
# The skill door (RESEARCH_PLAN.md). Real models plan poorly against an abstract
# {ticker} placeholder (they refuse — "no ticker provided" — or write concrete
# symbols anyway). So we invert the problem: BEFORE the call we swap the user's
# symbols for one concrete EXAMPLE_TICKER and tell the model plainly it is a
# stand-in; AFTER the call we swap that injected token back to {ticker}. Because
# WE chose the token, the substitution is deterministic — no guessing what the
# model wrote. The name is validated (short label, not the sentence, no token
# remnant), retried once on failure, and finally derived from the plan's tools.

# The stand-in symbol: unambiguous, Title Case, and never a real MODULE_REGISTRY
# input, so it can't collide with a fetched ticker.
EXAMPLE_TICKER = "ACME"

# Human labels for the tool-derived fallback name (keys are MODULE_REGISTRY /
# macro tools). Anything unmapped falls back to a title-cased key.
_TOOL_LABELS = {
    "technicals": "Technicals", "financials": "Financials", "options_flow": "Options Flow",
    "insider_activity": "Insider", "news_sentiment": "News", "peers": "Peers",
    "earnings": "Earnings", "analyst_ratings": "Analyst Ratings", "company": "Company",
    "quote": "Quote", "congressional_trades": "Congress", "dark_pool": "Dark Pool",
    "gamma_exposure": "Gamma Exposure", "macro": "Macro",
}

_PROPOSE_CORRECTIVE = (
    'Your previous JSON was rejected. Return {"name","subtasks"} exactly, where '
    '"name" is a short Title Case label (<=40 chars) summarizing the goal — NOT '
    "the request sentence and NOT containing " + EXAMPLE_TICKER + ' — and '
    '"subtasks" contains at least one data-fetch tool step.'
)


def _example_symbols(description, tickers) -> set:
    """Real symbols the user referenced: the request's tickers plus any
    ``$``-prefixed symbols in the description (e.g. ``$NVDA`` → ``NVDA``)."""
    syms = {t.strip().upper() for t in (tickers or []) if t and t.strip()}
    syms |= {m.upper() for m in re.findall(r"\$([A-Za-z]{1,6})", description or "")}
    return syms


def _swap(text: str, symbols, target: str) -> str:
    """Case-insensitively replace ``{ticker}`` and every symbol (bare or
    ``$``-prefixed) with ``target``. Used both ways: description→EXAMPLE_TICKER
    before the call, EXAMPLE_TICKER/symbols→{ticker} after."""
    out = (text or "").replace("{ticker}", target)
    for sym in symbols:
        if sym:
            out = re.sub(rf"\$?\b{re.escape(sym)}\b", target, out, flags=re.IGNORECASE)
    return out


def _name_from_tools(plan: Plan) -> str:
    """Fallback name derived from the plan's fetch tools — never a truncated
    sentence (e.g. ``Earnings + Options Flow Review``)."""
    labels = []
    for st in plan.subtasks:
        tool = resolve_tool(st.name)
        if tool == REASON_TOOL:
            continue
        label = _TOOL_LABELS.get(tool, tool.replace("_", " ").title())
        if label not in labels:
            labels.append(label)
    while labels and len(" + ".join(labels) + " Review") > 40:
        labels.pop()
    return (" + ".join(labels) + " Review") if labels else "Research Skill"


def _name_ok(name: str, *sentences) -> bool:
    """Accept a proposed name only if it is a short label: non-empty, ≤40 chars,
    free of the example/placeholder token, and not an echo (prefix) of any given
    sentence (the description or the canonicalized request)."""
    name = (name or "").strip()
    if not name or len(name) > 40:
        return False
    low = name.lower()
    if EXAMPLE_TICKER.lower() in low or "{ticker}" in low:
        return False
    return not any((s or "").strip().lower().startswith(low) for s in sentences if (s or "").strip())


def _has_fetch(plan) -> bool:
    """A usable skill plan pulls data — at least one non-reason step."""
    return bool(plan) and any(resolve_tool(st.name) != REASON_TOOL for st in plan.subtasks)


def _propose_once(client, canonical, max_subtasks, corrective=None):
    """One planner call → ``(raw_name, Plan)``; ``(None, None)`` on parse failure.
    ``canonical`` already has the user's symbols swapped for EXAMPLE_TICKER."""
    user = (
        f"Plan a reusable research skill for the example ticker {EXAMPLE_TICKER}.\n"
        f"User request (about {EXAMPLE_TICKER}): {canonical or '(none stated)'}\n"
        f"Allowed tools: {', '.join(ALLOWED_TOOLS)}\n"
        f"Return at most {max_subtasks} subtasks."
    )
    if corrective:
        user += f"\n\n{corrective}"
    try:
        resp = client.messages.create(
            model=RESEARCH_PLANNER_MODEL,
            max_tokens=800,
            system=_propose_system_prompt(),
            messages=[{"role": "user", "content": user}],
        )
        raw = resp.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1].lstrip("json").strip()
        parsed = json.loads(raw)
    except Exception as e:
        logger.debug("propose parse failed: %s", e)
        return None, None
    if not isinstance(parsed, dict):
        return None, None
    name = _cap_name(str(parsed.get("name", "")).strip())
    plan = Plan(subtasks=_clean_subtasks(parsed.get("subtasks", []), max_subtasks))
    return name, plan


def _propose_system_prompt() -> str:
    fetchers = ", ".join(sorted(FETCH_TOOLS))
    return (
        "You are the planner for a stock-research engine, drafting a REUSABLE "
        f"skill. You are given ONE example ticker, {EXAMPLE_TICKER} — a stand-in "
        "that the app replaces with the user's real symbol at run time. Plan as "
        f"if analyzing {EXAMPLE_TICKER}; write {EXAMPLE_TICKER} wherever a symbol "
        "belongs (do not invent other tickers).\n\n"
        "Return ONLY minified JSON, no prose, no code fences, matching exactly:\n"
        '{"name":"<short Title Case label>","subtasks":[{"name":"<tool>",'
        '"description":"<what this step does>","depends_on":["<earlier name>"]}]}\n\n'
        '"name": a concise Title Case label for the skill, at most 40 characters, '
        'summarizing the goal (e.g. "Earnings Deep Dive"). It must NOT be the '
        f"user's sentence and must NOT contain {EXAMPLE_TICKER}.\n\n"
        "Each subtask's \"name\" MUST be one of these tools:\n"
        f"  fetch tools (pull data for {EXAMPLE_TICKER}): {fetchers}\n"
        f"  \"{REASON_TOOL}\": analyze/compare the outputs of earlier subtasks.\n\n"
        "Rules: subtask names unique — reuse a tool by suffixing a number "
        "(reason, reason_2). depends_on lists earlier subtask names. Include at "
        "least one fetch tool. Prefer the fewest subtasks that answer the goal; "
        "end with a reason step that synthesizes when needed."
    )


def propose_plan(description, tickers=None, *, max_subtasks=SKILL_MAX_SUBTASKS, client=None):
    """Draft a reusable skill from a one-sentence description (invert-the-
    substitution — see the section banner).

    Returns ``(name, Plan)``: a short Title-Case name (validated, retried once,
    else derived from the plan's tools) and a ticker-agnostic plan whose step
    descriptions use ``{ticker}``. Never raises."""
    client = client or ANTHROPIC_CLIENT
    description = (description or "").strip()
    symbols = _example_symbols(description, tickers)
    canonical = _swap(description, symbols, EXAMPLE_TICKER)  # (1) plan against ACME

    name, plan = "", None
    if client.api_key:
        name, plan = _propose_once(client, canonical, max_subtasks)
        if not (_name_ok(name, description, canonical) and _has_fetch(plan)):
            name, plan = _propose_once(client, canonical, max_subtasks, corrective=_PROPOSE_CORRECTIVE)

    # (3) ensure a usable plan, and a clean name — derived from tools when the
    # model's name is bad OR its plan is degenerate (a refusal we can't trust).
    if not (plan and plan.subtasks):
        plan = _degraded_plan(canonical)
    if not _name_ok(name, description, canonical) or not _has_fetch(plan):
        name = _name_from_tools(plan)

    # (2) invert: the injected EXAMPLE_TICKER (and, as a second net, any real
    # symbol the model echoed) → the {ticker} placeholder. Deterministic.
    invert = {EXAMPLE_TICKER} | symbols
    name = _swap(name, invert, "{ticker}")
    plan = Plan(subtasks=[
        Subtask(name=st.name, description=_swap(st.description, invert, "{ticker}"),
                depends_on=list(st.depends_on))
        for st in plan.subtasks
    ])
    return name, plan
