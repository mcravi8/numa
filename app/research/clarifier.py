"""Clarifier gate: one cheap call that decides whether to ask the user anything
before planning — and is hard-biased toward asking NOTHING.

Modeled on the orchestrator's clarifier and on this repo's chat classifier
(app/research/classifier.py): a single Haiku-class call whose system prompt is
told to prefer zero questions and to ask only when an answer would *materially*
change the plan. It sits in front of BOTH doors (skills propose + chat
auto-deploy). It is:

* **Silent by default** — a clear objective yields ``{"clarify": false}``.
* **Fail-open** — a kill-switch (``NUMA_CLARIFIER=0``), a missing key, malformed
  JSON, or any exception all degrade to ``{"clarify": false, "questions": []}``.
  The gate can never *block* planning; the worst case is that it asks nothing.
* **Capped** — at most 3 questions, each with 2–4 concrete options; a
  ``clarify: true`` with no valid question collapses to ``clarify: false``
  (there is nothing to ask).

:func:`clarify` returns the wire shape the frontend renders;
:func:`format_clarifications` folds the user's answers into the ``User
clarifications:`` block the planner/propose prompts append.
"""

import json

from app.config import (
    ANTHROPIC_CLIENT,
    NUMA_CLARIFIER,
    RESEARCH_CLARIFIER_MODEL,
    logger,
)

_MAX_QUESTIONS = 3
_MAX_SUGGESTIONS = 4
# The silent verdict — the fail-open default returned from every degrade path.
_SILENT = {"clarify": False, "questions": []}


def _system_prompt(kind: str) -> str:
    subject = (
        "a saved, REUSABLE research skill (run later against many different tickers)"
        if kind == "skill"
        else "a research run"
    )
    reuse = (
        " Because the skill is reused across tickers, never ask about a specific "
        "company or ticker — ask only about scope, focus, or output."
        if kind == "skill"
        else ""
    )
    return (
        f"You gate the planner for {subject} in a stock-research engine. Before "
        "planning, decide whether to ask the user a SHORT clarifying question. "
        "Bias strongly toward NOT asking: if the objective already states its "
        "focus, metric, comparison, time frame, or desired output, ask NOTHING "
        f"(clarify:false).{reuse}\n\n"
        "Ask ONLY when the objective is so underspecified that the answer would "
        "MATERIALLY change the plan — which data modules run, which tickers, or "
        "what the output emphasizes. A bare, generic instruction with no stated "
        'focus or goal (e.g. "do a deep dive", "analyze this", "tell me '
        'everything", "what do you think") IS materially ambiguous: return 1-3 '
        "questions whose answers steer the plan — for example the investment "
        "angle (bull vs bear vs neutral), the time horizon, or which dimensions "
        "matter most (valuation, growth, technicals, risk).\n\n"
        "Return ONLY minified JSON, no prose, no code fences, matching exactly:\n"
        '{"clarify":true|false,"questions":[{"id":"q1","text":"<short question>",'
        '"suggestions":["<option>","<option>"],"suggested_answer":"<best guess or empty>"}]}\n\n'
        "Rules: at most 3 questions; ask the fewest that matter. Each question MUST "
        "offer 2 to 4 concrete, mutually distinct options. \"suggested_answer\" is "
        "your single best default (may be empty). If the objective is already "
        'specific, return {"clarify":false,"questions":[]}.'
    )


def _clean_questions(raw_qs) -> list:
    """Coerce the model's ``questions`` into ≤3 validated questions, each with
    ≤4 concrete suggestions and a deterministic ``q1..qN`` id. Junk is dropped."""
    if not isinstance(raw_qs, list):
        return []
    out = []
    for q in raw_qs:
        if len(out) >= _MAX_QUESTIONS:
            break
        if not isinstance(q, dict):
            continue
        text = str(q.get("text", "")).strip()
        if not text:
            continue
        sugg = q.get("suggestions", [])
        sugg = [str(s).strip() for s in sugg if str(s).strip()] if isinstance(sugg, list) else []
        out.append({
            "id": f"q{len(out) + 1}",
            "text": text,
            "suggestions": sugg[:_MAX_SUGGESTIONS],
            "suggested_answer": str(q.get("suggested_answer", "")).strip(),
        })
    return out


def _parse(raw: str) -> dict:
    """Parse the model's reply into the wire shape; any deviation → silent."""
    raw = (raw or "").strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1].lstrip("json").strip()
    parsed = json.loads(raw)  # caller catches — malformed JSON degrades to silent
    if not isinstance(parsed, dict) or not parsed.get("clarify"):
        return _SILENT
    questions = _clean_questions(parsed.get("questions", []))
    if not questions:  # clarify:true with nothing askable → ask nothing
        return _SILENT
    return {"clarify": True, "questions": questions}


def clarify(objective, tickers=None, *, kind="research", client=None) -> dict:
    """Decide whether to ask the user before planning ``objective``.

    Returns ``{"clarify": bool, "questions": [...]}``. ``kind`` is ``"skill"`` or
    ``"research"`` (lightly tailors the prompt). ``client`` is injectable for
    offline tests. NEVER raises and never blocks — every failure path is silent.
    """
    if not NUMA_CLARIFIER:
        return _SILENT
    objective = (objective or "").strip()
    if not objective:
        return _SILENT
    tickers = [t.strip().upper() for t in (tickers or []) if t and t.strip()]
    client = client or ANTHROPIC_CLIENT
    if not client.api_key:
        return _SILENT
    user = f"Tickers in scope: {', '.join(tickers) or '(none)'}\nObjective: {objective}"
    try:
        resp = client.messages.create(
            model=RESEARCH_CLARIFIER_MODEL,
            max_tokens=400,
            system=_system_prompt(kind),
            messages=[{"role": "user", "content": user}],
        )
        return _parse(resp.content[0].text)
    except Exception as e:
        logger.debug("clarifier failed, proceeding without questions: %s", e)
        return _SILENT


def format_clarifications(clarifications) -> str:
    """Fold answered clarifications into the ``User clarifications:`` prompt block.

    Accepts Clarification models or plain ``{question, answer}`` dicts. A question
    with no answer is a skip — omitted. Returns ``""`` when nothing was answered,
    so the caller appends nothing.
    """
    lines = []
    for it in (clarifications or []):
        if isinstance(it, dict):
            q, a = it.get("question", ""), it.get("answer", "")
        else:
            q, a = getattr(it, "question", ""), getattr(it, "answer", "")
        q, a = str(q or "").strip(), str(a or "").strip()
        if q and a:
            lines.append(f"- Q: {q}\n  A: {a}")
    if not lines:
        return ""
    return "User clarifications:\n" + "\n".join(lines)
