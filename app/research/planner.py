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

from app.config import ANTHROPIC_CLIENT, RESEARCH_PLANNER_MODEL, logger
from app.research.executor import ALLOWED_TOOLS, FETCH_TOOLS, REASON_TOOL
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

    if not cleaned:  # zero valid subtasks → degrade (AO behaviour)
        return _degraded_plan(objective)

    return Plan(subtasks=cleaned[:max_subtasks])
