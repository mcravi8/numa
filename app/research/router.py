"""Model router: which model (if any) runs a research step.

Ported from the agentic-orchestrator's routing mechanism — pure lookup, no I/O
and no new deps. One function, :func:`route_model`, maps a step's *kind* to a
concrete model id, or ``None`` for a fetch step (which runs a data module and
makes no LLM call at all):

    fetch      → None                            (no model, no LLM cost)
    reason     → config.RESEARCH_REASON_MODEL     (Sonnet by default)
    synthesis  → config.RESEARCH_SYNTHESIS_MODEL  (Sonnet by default; Opus via env)

A per-step ``model_override`` ("haiku"/"sonnet"/"opus") wins over the kind for
the two LLM kinds. A fetch step never gets a model — it has nothing to run on an
LLM — so an override on a fetch step is ignored.

The executor asks the router for the model of every LLM call it makes, and the
cost estimator prices every step against the same routing, so the projected cost
and the real run never disagree. Config values are read through the module (not
bound at import) so an env swap of the synthesis model is honored live.
"""

from typing import Optional

from app import config
from app.research.schemas import KIND_FETCH, KIND_SYNTHESIS, coerce_kind, coerce_override


def route_model(kind: str, model_override=None) -> Optional[str]:
    """Return the model id for a step of ``kind``, or ``None`` for a fetch step.

    ``model_override`` (a tier alias) wins over the kind for LLM steps; it is
    ignored for fetch steps. Both inputs are coerced, so junk never raises: a bad
    kind falls back to ``reason``, a bad override to no override.
    """
    kind = coerce_kind(kind)
    if kind == KIND_FETCH:
        return None
    override = coerce_override(model_override)
    if override:
        return config.MODEL_ALIASES[override]
    if kind == KIND_SYNTHESIS:
        return config.RESEARCH_SYNTHESIS_MODEL
    return config.RESEARCH_REASON_MODEL
