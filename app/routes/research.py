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

from app.research.executor import run_plan
from app.research.planner import build_plan
from app.research.schemas import Plan

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
            ):
                yield _sse(event)
        except Exception as e:  # never leak a 500 mid-stream; end cleanly
            yield _sse({"type": "error", "error": str(e)})
        yield "data: [DONE]\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream", headers=_SSE_HEADERS)
