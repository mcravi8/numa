"""Offline tests for the per-step model routing + cost estimate mechanisms.

No live Claude call: the cost estimate is pure math, the router is a pure lookup,
and the executor-routing test drives run_plan against the recorded FakeTicker with
a mocked, call-recording Anthropic client (see conftest). Every USD figure here is
a fixed-input unit vector computed from the documented formula.
"""
import asyncio

from fastapi.testclient import TestClient

from app.config import (
    MODEL_ALIASES,
    RESEARCH_MAX_OUTPUT_TOKENS,
    RESEARCH_REASON_MODEL,
    RESEARCH_SYNTHESIS_MODEL,
)
from app.research.cost_estimate import _tokens, estimate_plan, estimate_step
from app.research.executor import run_plan
from app.research.router import route_model
from app.research.schemas import Plan, Subtask, coerce_kind, coerce_override
from main import app

client = TestClient(app)

SONNET = MODEL_ALIASES["sonnet"]
OPUS = MODEL_ALIASES["opus"]
HAIKU = MODEL_ALIASES["haiku"]


def _drain(agen):
    async def _collect():
        return [ev async for ev in agen]
    return asyncio.run(_collect())


# ============================================================
# === COST MATH — fixed-input unit vectors ===
# ============================================================
# input = (len(objective)+len(desc)+sum(dep lens))//4 + 500
# output = clamp(input*1.75, 200, RESEARCH_MAX_OUTPUT_TOKENS)
# usd = (input*price_in + output*price_out)/1e6

def test_tokens_formula_exact():
    # 40 + 40 + 20 = 100 chars → 100//4 + 500 = 525 input; 525*1.75 = 918.75 → 918.
    inp, out = _tokens("x" * 40, "y" * 40, ["z" * 20])
    assert inp == 525
    assert out == 918


def test_tokens_output_caps_at_config_max():
    # Long enough that input*1.75 exceeds the cap → output clamps to config max.
    inp, out = _tokens("a" * 744, "", [])
    assert inp == 686                          # 744//4 + 500
    assert out == RESEARCH_MAX_OUTPUT_TOKENS   # 686*1.75 = 1200.5 → clamped to 1200


def test_estimate_step_usd_per_model_exact():
    # Same 525 in / 918 out step, priced on each tier (per-M: 1/5, 3/15, 15/75).
    args = ("x" * 40, "y" * 40, ["z" * 20])
    assert estimate_step(*args, SONNET)["usd"] == (525 * 3 + 918 * 15) / 1e6   # 0.015345
    assert estimate_step(*args, HAIKU)["usd"] == (525 * 1 + 918 * 5) / 1e6     # 0.005115
    assert estimate_step(*args, OPUS)["usd"] == (525 * 15 + 918 * 75) / 1e6    # 0.076725


def test_estimate_step_fetch_is_free():
    est = estimate_step("obj", "desc", [], None)   # model None → a fetch step
    assert est["usd"] == 0.0
    assert est["input_tokens"] == 0 and est["output_tokens"] == 0
    assert est["model"] is None and est["model_label"] == "—"


def test_estimate_plan_totals_and_kinds():
    plan = Plan(subtasks=[
        Subtask(name="technicals", description="pull technicals", depends_on=[]),
        Subtask(name="reason", description="assess", depends_on=["technicals"]),
        Subtask(name="reason_2", description="opus pass", depends_on=["technicals"],
                model_override="opus"),
    ])
    out = estimate_plan(plan, "quick read")

    kinds = {s["name"]: s["kind"] for s in out["steps"]}
    models = {s["name"]: s["model"] for s in out["steps"]}
    assert kinds == {"technicals": "fetch", "reason": "reason", "reason_2": "reason"}
    assert models["technicals"] is None            # fetch: no model
    assert models["reason"] == RESEARCH_REASON_MODEL
    assert models["reason_2"] == OPUS              # override wins

    # Fetch step is free; the two LLM steps cost something.
    usd = {s["name"]: s["usd"] for s in out["steps"]}
    assert usd["technicals"] == 0.0
    assert usd["reason"] > 0 and usd["reason_2"] > usd["reason"]   # opus dearer than sonnet

    # Totals = agents (plan steps) + implicit synthesis.
    assert out["synthesis"]["kind"] == "synthesis"
    assert out["synthesis"]["model"] == RESEARCH_SYNTHESIS_MODEL
    assert out["agents_usd"] == round(sum(usd.values()), 4)
    assert out["total_usd"] == round(out["agents_usd"] + out["synthesis_usd"], 4)


# ============================================================
# === KIND COERCION ===
# ============================================================

def test_coerce_kind_valid_and_invalid():
    assert coerce_kind("fetch") == "fetch"
    assert coerce_kind("reason") == "reason"
    assert coerce_kind("synthesis") == "synthesis"
    assert coerce_kind("SYNTHESIS") == "synthesis"     # case-normalized
    assert coerce_kind("  Reason ") == "reason"        # trimmed
    assert coerce_kind("banana") == "reason"           # invalid → reason
    assert coerce_kind("") == "reason"
    assert coerce_kind(None) == "reason"


def test_subtask_coerces_bad_kind_and_override():
    st = Subtask(name="reason", kind="banana", model_override="titanium")
    assert st.kind == "reason"            # bad kind → reason
    assert st.model_override is None      # bad override → none
    ok = Subtask(name="reason", kind="Synthesis", model_override="OPUS")
    assert ok.kind == "synthesis" and ok.model_override == "opus"


def test_coerce_override():
    assert coerce_override("opus") == "opus"
    assert coerce_override("SONNET") == "sonnet"
    assert coerce_override("gpt") is None
    assert coerce_override(None) is None


# ============================================================
# === ROUTING — override precedence ===
# ============================================================

def test_route_model_by_kind():
    assert route_model("fetch") is None
    assert route_model("reason") == RESEARCH_REASON_MODEL
    assert route_model("synthesis") == RESEARCH_SYNTHESIS_MODEL
    assert route_model("garbage") == RESEARCH_REASON_MODEL   # bad kind → reason model


def test_route_model_override_wins_over_kind():
    assert route_model("reason", "opus") == OPUS
    assert route_model("synthesis", "haiku") == HAIKU
    assert route_model("reason", "sonnet") == SONNET
    # A bad override is ignored (falls back to the kind).
    assert route_model("reason", "bogus") == RESEARCH_REASON_MODEL


def test_route_model_fetch_ignores_override():
    # A fetch step makes no LLM call, so an override can't resurrect one.
    assert route_model("fetch", "opus") is None


# ============================================================
# === ESTIMATE ENDPOINT SMOKE ===
# ============================================================

def test_estimate_endpoint():
    plan = {"subtasks": [
        {"name": "technicals", "description": "pull technicals", "depends_on": []},
        {"name": "reason", "description": "assess", "depends_on": ["technicals"]},
    ]}
    r = client.post("/research/estimate", json={"plan": plan, "objective": "read AAPL"})
    assert r.status_code == 200
    body = r.json()
    assert {"steps", "synthesis", "agents_usd", "synthesis_usd", "total_usd"} <= set(body)
    for step in body["steps"]:
        assert {"name", "kind", "model", "usd"} <= set(step)
    assert body["steps"][0]["kind"] == "fetch" and body["steps"][0]["usd"] == 0.0
    assert body["steps"][1]["kind"] == "reason" and body["steps"][1]["model"] == RESEARCH_REASON_MODEL
    assert body["total_usd"] == round(body["agents_usd"] + body["synthesis_usd"], 4)


# ============================================================
# === EXECUTOR ROUTES CALLS TO THE RIGHT MODELS ===
# ============================================================

def test_executor_routes_fetch_reason_synthesis(monkeypatch, fake_anthropic, make_msg, fake_stock, recorded_info):
    # Scope to routing: disable the (separately-tested) validator so create calls
    # are exactly the reason steps.
    from app.research import validator
    monkeypatch.setattr(validator, "NUMA_VALIDATOR", False)
    plan = Plan(subtasks=[
        Subtask(name="technicals", description="pull technicals", depends_on=[]),
        Subtask(name="reason", description="assess", depends_on=["technicals"]),
        Subtask(name="reason_2", description="opus pass", depends_on=["technicals"],
                model_override="opus"),
    ])
    fake = fake_anthropic(create_fn=lambda kw: make_msg("reasoned"), stream_tokens=("done.",))
    _drain(run_plan(
        plan, ["AAPL"], client=fake,
        stock_factory=lambda t: (fake_stock, recorded_info),
    ))

    # The fetch step makes NO LLM call; only the two reason steps do.
    create_models = [c["model"] for c in fake.messages.create_calls]
    assert create_models == [RESEARCH_REASON_MODEL, OPUS]   # default sonnet, then override opus
    # Synthesis streamed on the synthesis model.
    stream_models = [c["model"] for c in fake.messages.stream_calls]
    assert stream_models == [RESEARCH_SYNTHESIS_MODEL]
