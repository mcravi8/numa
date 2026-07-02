"""Chat auto-research decision: answer DIRECT (default) or DEPLOY an auto-plan.

The automatic door (docs/RESEARCH_PLAN.md), built with a HARD bias toward direct
answering. Two gates, cheapest first:

1. A **kill-switch** (``config.NUMA_AUTO_RESEARCH``) and a **cheap heuristic**
   both short-circuit to DIRECT with NO model call. A single ticker + a short,
   one-part question never reaches a classifier.
2. Only when the heuristic sees a complexity signal (multi-ticker comparison,
   "build a case", "deep dive", an explicit multi-step ask, or a long
   multi-clause question) do we spend a tiny Haiku-class classifier call — and
   its prompt is told: when in doubt, answer DIRECT.

Kept model-testable: :func:`decide` takes an injectable ``client`` and never
raises (any classifier failure degrades to DIRECT).
"""

import re

from app.config import (
    ANTHROPIC_CLIENT,
    NUMA_AUTO_RESEARCH,
    RESEARCH_CLASSIFIER_MODEL,
    logger,
)

# Phrases that make a question worth *considering* a multi-step run. If none
# fire (and it's not multi-ticker), we answer directly and never call the
# classifier. Mirrored by the frontend pre-filter in static/js/07-research.js.
_COMPLEX_PATTERNS = [
    r"\bcompare\b", r"\bvs\.?\b", r"\bversus\b",
    r"\bdeep[\s-]?dive\b", r"\bbuild (?:a|the) case\b", r"\bmake (?:a|the) case\b",
    r"\bbull (?:and|&|/) bear\b", r"\bbear (?:and|&|/) bull\b",
    r"\bwalk me through\b", r"\bstep[\s-]?by[\s-]?step\b", r"\bcomprehensive\b",
    r"\bfull (?:analysis|breakdown|picture|report|dd)\b", r"\bthesis\b",
    r"\beverything (?:about|on)\b", r"\bend[\s-]?to[\s-]?end\b",
]
_COMPLEX_RE = re.compile("|".join(_COMPLEX_PATTERNS), re.IGNORECASE)

# A long, multi-clause ask (word count) is itself a complexity signal.
_LONG_WORDS = 45


def _signals_complexity(question: str, tickers) -> bool:
    """Cheap gate: does this question even warrant considering a research run?"""
    q = (question or "").strip()
    if len([t for t in (tickers or []) if t and str(t).strip()]) >= 2:
        return True
    if _COMPLEX_RE.search(q):
        return True
    return len(q.split()) >= _LONG_WORDS


def _classify(question: str, tickers, client) -> bool:
    """One Haiku-class call, HARD-biased to DIRECT. Returns True only to deploy."""
    if not client.api_key:
        return False
    system = (
        "You gate a stock-research chat: decide if a question needs a MULTI-STEP "
        "research run or a DIRECT answer. STRONGLY prefer DIRECT. Reply with ONE "
        "word: DIRECT or RESEARCH. Choose RESEARCH only for genuinely multi-step "
        "work — comparing several tickers, building a full bull-and-bear case, or "
        "an explicit end-to-end deep dive across many data sources. A single "
        "factual lookup, a definition, or a one-part question is DIRECT. When in "
        "doubt, answer DIRECT."
    )
    user = f"Tickers in scope: {', '.join(tickers) or '(none)'}\nQuestion: {question}"
    try:
        resp = client.messages.create(
            model=RESEARCH_CLASSIFIER_MODEL,
            max_tokens=4,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        verdict = (resp.content[0].text or "").strip().upper()
    except Exception as e:
        logger.debug("classifier failed, defaulting to direct: %s", e)
        return False
    return verdict.startswith("RESEARCH")


def decide(question, tickers=None, *, client=None) -> dict:
    """Return ``{"deploy": bool, "reason": str}`` for a chat question.

    Hard bias to direct: the kill-switch and the heuristic gate each return
    DIRECT with no classifier call; only a complexity signal reaches the
    (direct-biased) classifier."""
    tickers = [t.strip().upper() for t in (tickers or []) if t and t.strip()]
    if not NUMA_AUTO_RESEARCH:
        return {"deploy": False, "reason": "auto-research disabled"}
    if not _signals_complexity(question, tickers):
        return {"deploy": False, "reason": "no complexity signal — direct"}
    client = client or ANTHROPIC_CLIENT
    if _classify(question, tickers, client):
        return {"deploy": True, "reason": "classifier: research"}
    return {"deploy": False, "reason": "classifier: direct"}
