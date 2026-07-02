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

from pydantic import BaseModel, Field


class Subtask(BaseModel):
    """One planned step. ``name`` selects the tool (see module docstring)."""

    name: str
    description: str = ""
    depends_on: List[str] = Field(default_factory=list)


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
        )
        for st in plan.subtasks
    ]
    return Plan(subtasks=rendered)
