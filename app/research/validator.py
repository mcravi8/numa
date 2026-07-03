"""Output validator: one Sonnet call that grades the finished memo, so a weak
synthesis gets exactly one chance to be rewritten before it ships.

Modeled on the orchestrator's output validator (and this repo's clarifier/
classifier gates): after synthesis completes, :func:`validate` scores the memo
against the objective and the subtask findings on a 0–10 scale and returns
concrete feedback. The executor retries synthesis ONCE when the score is below
the bar (see app/research/executor.py); the second draft ships regardless.

It is **fail-open** — a kill-switch (``NUMA_VALIDATOR=0``), a missing key,
malformed JSON, or any exception all return a passing verdict (score 10, ok=true)
so validation can never block or fail a run; the worst case is that a weak memo
ships unrevised. Every real call's tokens flow back to the caller (returned
alongside the verdict) so the accumulated cost stays truthful.
"""

import json

from app.config import (
    ANTHROPIC_CLIENT,
    NUMA_VALIDATOR,
    RESEARCH_VALIDATOR_MODEL,
    logger,
)

# The passing bar: a memo scoring at or above this ships unrevised.
_OK_THRESHOLD = 6.0
# Cap on how much findings JSON is fed to the grader (mirrors the executor cap).
_CONTEXT_CHARS = 6000


def enabled() -> bool:
    """Whether scoring runs at all (the executor gates the event/retry on this)."""
    return NUMA_VALIDATOR


def _pass() -> dict:
    """The fail-open passing verdict (fresh dict — ``issues`` is mutable)."""
    return {"score": 10.0, "ok": True, "issues": [], "feedback": ""}


def _system_prompt() -> str:
    return (
        "You are a strict senior editor grading a stock-research memo. Score how "
        "well the memo answers the stated objective using ONLY the provided "
        "findings: reward specific, numeric, on-topic, non-fabricated, complete "
        "answers; penalize vagueness, hedging, invented figures, and anything the "
        "findings do not support.\n\n"
        "Return ONLY minified JSON, no prose, no code fences, matching exactly:\n"
        '{"score":<number 0.0-10.0>,"ok":<bool>,"issues":["<short issue>"],'
        '"feedback":"<one paragraph of concrete, actionable revision guidance>"}\n\n'
        "0 is unusable, 6 is the acceptable bar, 10 is excellent. \"issues\" lists "
        "concrete problems (empty when none). \"feedback\" tells the writer exactly "
        "what to add or fix; keep it short and specific."
    )


def _user(objective: str, synthesis: str, outputs) -> str:
    findings = json.dumps(outputs, default=str)[:_CONTEXT_CHARS] if outputs else "(none)"
    return (
        f"Objective: {objective or '(none stated)'}\n\n"
        f"Findings the memo must be grounded in:\n{findings}\n\n"
        f"Memo to grade:\n{synthesis}"
    )


def _parse(raw: str) -> dict:
    """Parse the grader's reply into the verdict; any deviation raises (the caller
    catches and fails open). ``ok`` is recomputed from the clamped score."""
    raw = (raw or "").strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1].lstrip("json").strip()
    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        raise ValueError("validator did not return a JSON object")
    score = max(0.0, min(10.0, float(parsed.get("score"))))  # non-numeric → ValueError
    issues = parsed.get("issues", [])
    issues = [str(i).strip() for i in issues if str(i).strip()] if isinstance(issues, list) else []
    return {
        "score": round(score, 1),
        "ok": score >= _OK_THRESHOLD,
        "issues": issues,
        "feedback": str(parsed.get("feedback", "")).strip(),
    }


def validate(objective, synthesis, outputs, *, client=None):
    """Grade ``synthesis`` against ``objective`` + ``outputs``.

    Returns ``(verdict, usage)`` where ``verdict`` is
    ``{"score", "ok", "issues", "feedback"}`` and ``usage`` is the call's token
    usage (None on any fail-open path, so the caller's ``usage.add`` is a no-op).
    NEVER raises.
    """
    if not NUMA_VALIDATOR:
        return _pass(), None
    synthesis = (synthesis or "").strip()
    if not synthesis:
        return _pass(), None
    client = client or ANTHROPIC_CLIENT
    if not client.api_key:
        return _pass(), None
    try:
        resp = client.messages.create(
            model=RESEARCH_VALIDATOR_MODEL,
            max_tokens=500,
            system=_system_prompt(),
            messages=[{"role": "user", "content": _user(objective, synthesis, outputs)}],
        )
    except Exception as e:  # the call itself failed → no tokens spent
        logger.debug("validator call failed, passing memo unrevised: %s", e)
        return _pass(), None
    # The call succeeded and cost tokens — count them even if the reply can't be
    # parsed (truthful cost), then fail open on the verdict.
    usage = getattr(resp, "usage", None)
    try:
        return _parse(resp.content[0].text), usage
    except Exception as e:
        logger.debug("validator output unparseable, passing memo unrevised: %s", e)
        return _pass(), usage
