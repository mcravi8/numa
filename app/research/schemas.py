"""Research engine wire shapes.

The plan JSON schema is **AO's verbatim** (from docs/RESEARCH_PLAN.md), for
future interop with the agentic-orchestrator repo:

    {"subtasks": [{"name", "description", "depends_on": []}]}

A subtask's ``name`` doubles as its tool selector: the executor resolves it to a
fetch tool (a MODULE_REGISTRY key or ``macro``) or, failing that, to the
free-form ``reason`` tool (a Claude call over the outputs of its ``depends_on``).
Names should be unique so ``depends_on`` can reference them; reuse a tool by
suffixing a number (``reason``, ``reason_2``) — the executor strips the suffix
when resolving the tool.

The Skill DTO mirrors AO's Skill (name, description, version, plan template)
minus DB fields. A skill's plan is a **template**: subtask descriptions may embed
the ``{ticker}`` placeholder, filled in at run time by :func:`render_plan`.
"""

from typing import List, Optional

from pydantic import BaseModel, Field, field_validator

# --- Step kinds — the routing / cost vocabulary --------------------------
# A subtask's ``kind`` drives model routing (router.route_model) and cost
# estimation (cost_estimate). Three kinds:
#   ``fetch``      a data-module tool (technicals, financials, macro, …): runs a
#                  module, makes no LLM call, so it has no LLM cost.
#   ``reason``     a Claude call over earlier steps' outputs.
#   ``synthesis``  a Claude call routed to the (possibly larger) synthesis model.
# The planner MAY emit a kind; anything invalid coerces to ``reason``. The final
# run-wide synthesis pass is kind ``synthesis`` implicitly — it is not a subtask.
KIND_FETCH = "fetch"
KIND_REASON = "reason"
KIND_SYNTHESIS = "synthesis"
VALID_KINDS = (KIND_FETCH, KIND_REASON, KIND_SYNTHESIS)

# The per-step ``model_override`` vocabulary: a tier alias the router resolves to
# a concrete model id. Anything else coerces to None (no override → route by kind).
MODEL_OVERRIDES = ("haiku", "sonnet", "opus")


def coerce_kind(kind) -> str:
    """Normalize a step kind to one of :data:`VALID_KINDS`; invalid → ``reason``."""
    k = str(kind or "").strip().lower()
    return k if k in VALID_KINDS else KIND_REASON


def coerce_override(value) -> Optional[str]:
    """Normalize a ``model_override`` to a known tier alias, else None."""
    v = str(value or "").strip().lower()
    return v if v in MODEL_OVERRIDES else None


class Subtask(BaseModel):
    """One planned step. ``name`` selects the tool (see module docstring).

    ``kind`` and ``model_override`` steer model routing / cost (see the kind
    vocabulary above); both are lenient — invalid input coerces rather than
    raising, so a stray planner value never 500s a plan.
    """

    name: str
    description: str = ""
    depends_on: List[str] = Field(default_factory=list)
    kind: str = KIND_REASON
    model_override: Optional[str] = None

    @field_validator("kind", mode="before")
    @classmethod
    def _coerce_kind(cls, v):
        return coerce_kind(v)

    @field_validator("model_override", mode="before")
    @classmethod
    def _coerce_override(cls, v):
        return coerce_override(v)


class Plan(BaseModel):
    """AO's plan shape: an ordered list of subtasks."""

    subtasks: List[Subtask] = Field(default_factory=list)


class Skill(BaseModel):
    """A saved, editable pipeline (AO's Skill DTO minus DB fields).

    ``id`` is a uuid assigned on save (None for an unsaved draft); ``version``
    increments on edit. ``plan`` is a template whose subtask descriptions may
    contain ``{ticker}`` placeholders (see :func:`render_plan`).
    """

    id: Optional[str] = None
    name: str
    description: str = ""
    version: int = 1
    plan: Plan = Field(default_factory=Plan)


def render_plan(plan: Plan, ticker: str) -> Plan:
    """Fill ``{ticker}`` placeholders in a plan template with a concrete ticker.

    Returns a new Plan (the template is left untouched). Only descriptions carry
    the placeholder convention; names/depends_on are copied verbatim so
    dependency wiring survives rendering.
    """
    ticker = (ticker or "").upper().strip()
    rendered = [
        Subtask(
            name=st.name,
            description=st.description.replace("{ticker}", ticker),
            depends_on=list(st.depends_on),
            kind=st.kind,
            model_override=st.model_override,
        )
        for st in plan.subtasks
    ]
    return Plan(subtasks=rendered)
