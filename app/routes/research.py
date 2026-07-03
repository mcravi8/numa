"""Research endpoints: plan → run → stream.

The deliberate three-step flow (see docs/RESEARCH_PLAN.md), so the user can
approve/edit a plan before it costs anything:

* ``POST /research/plan`` {objective, tickers[]} → a plan (AO's JSON shape) for
  the user to review — one planner call, no execution.
* ``POST /research/run`` {plan, tickers[]} → {run_id}. The (possibly edited)
  plan is parked in an in-memory dict, consumed exactly once by the stream.
* ``GET /research/stream/{run_id}`` → the executor's typed events as SSE,
  mirroring the analyze stream's ``data: {json}\\n\\n`` convention, headers, and
  trailing ``[DONE]`` sentinel exactly. An unknown/expired run_id yields a clean
  SSE ``error`` event (not an HTTP error), then ``[DONE]``.

Runs live only in process memory (no new infrastructure) and are single-use, so
a run_id can't be replayed or leaked into a second stream.
"""

import json
import uuid
from typing import List

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.research import clarifier
from app.research.classifier import decide
from app.research.cost_estimate import estimate_plan
from app.research.executor import UsageAccumulator, run_plan
from app.research.planner import AUTO_MAX_SUBTASKS, build_plan
from app.research.schemas import Clarification, Plan

router = APIRouter()

# In-memory, single-use run store: run_id -> {plan, tickers, objective, mode}.
# Deliberately not persisted — a research run is ephemeral (RESEARCH_PLAN.md:
# "no new infrastructure"). The stream endpoint pops entries so each is consumed
# exactly once.
_RUNS: dict = {}

# Same SSE headers the analyze stream sets, verbatim.
_SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload, default=str)}\n\n"


# ============================================================
# === PLAN — propose a plan for user approval ===
# ============================================================

class PlanRequest(BaseModel):
    objective: str
    tickers: List[str] = Field(default_factory=list)


@router.post("/research/plan")
def research_plan(req: PlanRequest) -> dict:
    """One planner call → the proposed plan (AO's {"subtasks": [...]}) for the
    user to review/edit before running. Degrades gracefully (never 500s on a
    bad model response — see build_plan)."""
    plan = build_plan(req.objective, req.tickers)
    return plan.model_dump()


# ============================================================
# === ESTIMATE — project a plan's USD cost before running it ===
# ============================================================
# Pure math (app/research/cost_estimate.py) — no LLM call — so the run-confirm
# screen and the skill editor can price a plan (per step + projected total) and
# re-price it live as steps/models are edited.

class EstimateRequest(BaseModel):
    plan: Plan
    objective: str = ""


@router.post("/research/estimate")
def research_estimate(req: EstimateRequest) -> dict:
    """Per-step {name, kind, model, usd} + {agents_usd, synthesis_usd, total_usd}
    for a plan run against ``objective``. No LLM call, never raises on a bad plan."""
    return estimate_plan(req.plan, req.objective)


# ============================================================
# === RUN — register an (approved) plan, hand back a run_id ===
# ============================================================

class RunRequest(BaseModel):
    plan: Plan
    tickers: List[str] = Field(default_factory=list)
    objective: str = ""
    mode: str = "free"


@router.post("/research/run")
def research_run(req: RunRequest) -> dict:
    """Park the approved plan and return a single-use run_id to stream."""
    run_id = uuid.uuid4().hex
    _RUNS[run_id] = {
        "plan": req.plan,
        "tickers": req.tickers,
        "objective": req.objective,
        "mode": req.mode,
    }
    return {"run_id": run_id}


# ============================================================
# === STREAM — execute a parked run as SSE ===
# ============================================================

@router.get("/research/stream/{run_id}")
def research_stream(run_id: str) -> StreamingResponse:
    """Stream the executor's events for a parked run. Consumes the run_id (pop),
    so it cannot be replayed. Unknown/expired id → a clean SSE error event."""
    run = _RUNS.pop(run_id, None)

    async def gen():
        if run is None:
            yield _sse({"type": "error", "error": f"unknown or expired run_id: {run_id}"})
            yield "data: [DONE]\n\n"
            return
        try:
            async for event in run_plan(
                run["plan"], run["tickers"],
                objective=run["objective"], mode=run["mode"],
                usage=run.get("usage"),
            ):
                yield _sse(event)
        except Exception as e:  # never leak a 500 mid-stream; end cleanly
            yield _sse({"type": "error", "error": str(e)})
        yield "data: [DONE]\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream", headers=_SSE_HEADERS)


# ============================================================
# === CHAT AUTO-RESEARCH — decide direct vs deploy a plan ===
# ============================================================
# The automatic door (RESEARCH_PLAN.md): the /numa chat asks whether a question
# warrants a throwaway auto-plan. Hard-biased to direct (see classifier.decide).
# On deploy it builds a plan capped at AUTO_MAX_SUBTASKS (5), parks it as a
# single-use run seeded with the planner's token usage, and hands back the plan +
# run_id for the chat to stream (progress rows → synthesis → usage).

class ChatResearchRequest(BaseModel):
    question: str
    tickers: List[str] = Field(default_factory=list)
    mode: str = "free"
    # Clarifier round-trip (same pattern as /skills/propose): the first POST
    # leaves ``clarified`` false. If the deploy decision passes and the clarifier
    # asks something, we return the questions (deploy still false) and the chat
    # re-POSTs with ``clarified=true`` + answers to proceed to the run.
    clarified: bool = False
    clarifications: List[Clarification] = Field(default_factory=list)


@router.post("/numa/research")
def numa_research(req: ChatResearchRequest) -> dict:
    # First pass: gate the question (deploy?) then the clarifier (ask?). The
    # re-POST (clarified=true) skips both — the decision was already made — and
    # goes straight to planning with the answers folded in.
    if not req.clarified:
        verdict = decide(req.question, req.tickers)
        if not verdict["deploy"]:
            return {"deploy": False, "reason": verdict["reason"]}
        gate = clarifier.clarify(req.question, tickers=req.tickers, kind="research")
        if gate["clarify"]:
            return {"deploy": False, "clarify": True, "questions": gate["questions"],
                    "reason": "clarify"}

    clar_block = clarifier.format_clarifications(req.clarifications)
    usage = UsageAccumulator()  # seeded with the planner call, carried into the run
    plan = build_plan(req.question, req.tickers, max_subtasks=AUTO_MAX_SUBTASKS,
                      usage=usage, clarifications=clar_block)
    run_id = uuid.uuid4().hex
    _RUNS[run_id] = {
        "plan": plan,
        "tickers": req.tickers,
        "objective": req.question,
        "mode": req.mode,
        "usage": usage,
    }
    return {"deploy": True, "run_id": run_id, "plan": plan.model_dump(),
            "tickers": req.tickers, "reason": "deploy"}
