"""Offline tests for the chat auto-research decision (classifier.decide) and the
/numa/research endpoint. The classifier client is always mocked — no live call.
"""
import pytest
from fastapi.testclient import TestClient

import app.research.classifier as classifier_mod
from app.research.classifier import decide
from main import app

client = TestClient(app)


# Ten simple, single-part questions on one ticker — all must answer DIRECT with
# NO classifier call (the cheap heuristic decides).
SIMPLE_QUESTIONS = [
    "What is AAPL's P/E ratio?",
    "Is AAPL up today?",
    "What's the RSI on AAPL?",
    "What is AAPL's dividend yield?",
    "When is AAPL's next earnings date?",
    "What sector is AAPL in?",
    "What is AAPL's market cap?",
    "What's AAPL's 52-week high?",
    "Any recent AAPL news?",
    "What is AAPL's current price?",
]

# Three clearly multi-step prompts — the heuristic fires, the (mocked) classifier
# says RESEARCH, so they deploy.
MULTISTEP_PROMPTS = [
    ("Compare AAPL and MSFT on margins, growth and valuation", ["AAPL", "MSFT"]),
    ("Build a full bull and bear case for NVDA into earnings", ["NVDA"]),
    ("Do a comprehensive deep dive on TSLA across financials, options, insiders and news", ["TSLA"]),
]


def _counting_client(fake_anthropic, make_msg, verdict="RESEARCH"):
    """A fake client that counts classifier calls and returns a fixed verdict."""
    calls = {"n": 0}

    def create_fn(kw):
        calls["n"] += 1
        return make_msg(verdict)

    return fake_anthropic(create_fn=create_fn), calls


@pytest.mark.parametrize("q", SIMPLE_QUESTIONS)
def test_simple_questions_route_direct_without_classifier(q, fake_anthropic, make_msg):
    fake, calls = _counting_client(fake_anthropic, make_msg)
    verdict = decide(q, ["AAPL"], client=fake)
    assert verdict["deploy"] is False
    assert calls["n"] == 0        # heuristic decided — the classifier was never called


@pytest.mark.parametrize("q,tickers", MULTISTEP_PROMPTS)
def test_multistep_prompts_route_deploy(q, tickers, fake_anthropic, make_msg):
    fake, _ = _counting_client(fake_anthropic, make_msg, verdict="RESEARCH")
    verdict = decide(q, tickers, client=fake)
    assert verdict["deploy"] is True


def test_kill_switch_forces_direct(monkeypatch, fake_anthropic, make_msg):
    monkeypatch.setattr(classifier_mod, "NUMA_AUTO_RESEARCH", False)
    fake, calls = _counting_client(fake_anthropic, make_msg, verdict="RESEARCH")
    q, tickers = MULTISTEP_PROMPTS[0]
    verdict = decide(q, tickers, client=fake)
    assert verdict["deploy"] is False
    assert calls["n"] == 0        # kill-switch short-circuits before any call


def test_classifier_biased_direct_can_decline(fake_anthropic, make_msg):
    # A complexity-signalled question the classifier judges DIRECT stays direct.
    fake, calls = _counting_client(fake_anthropic, make_msg, verdict="DIRECT")
    q, tickers = MULTISTEP_PROMPTS[1]
    verdict = decide(q, tickers, client=fake)
    assert verdict["deploy"] is False
    assert calls["n"] == 1        # heuristic fired → classifier consulted → declined


# ============================================================
# === /numa/research endpoint ===
# ============================================================

def test_numa_research_direct(patch_research, fake_anthropic, make_msg):
    # A simple question → deploy False, no run registered.
    patch_research(fake_anthropic(create_fn=lambda kw: make_msg("DIRECT")))
    r = client.post("/numa/research", json={"question": "What is AAPL's P/E?", "tickers": ["AAPL"]})
    assert r.status_code == 200
    body = r.json()
    assert body["deploy"] is False
    assert "run_id" not in body


def test_numa_research_deploy_then_stream(patch_research, fake_anthropic, make_msg):
    # A multi-step prompt → classifier RESEARCH → plan built → run_id streams,
    # ending with a usage event then complete.
    plan_json = '{"subtasks":[{"name":"technicals","description":"pull","depends_on":[]},{"name":"reason","description":"tie","depends_on":["technicals"]}]}'

    def create_fn(kw):
        # classifier asks for one word; planner/reason ask for JSON/prose.
        if "DIRECT or RESEARCH" in kw.get("system", ""):
            return make_msg("RESEARCH")
        if "planner" in kw.get("system", ""):
            return make_msg(plan_json)
        return make_msg("reasoned")

    patch_research(fake_anthropic(create_fn=create_fn, stream_tokens=("Bottom line.",)))
    r = client.post("/numa/research", json={
        "question": "Compare AAPL and MSFT on growth and valuation", "tickers": ["AAPL", "MSFT"]})
    assert r.status_code == 200
    body = r.json()
    assert body["deploy"] is True
    assert body["run_id"] and body["plan"]["subtasks"]
    assert len(body["plan"]["subtasks"]) <= 5   # capped at the auto limit

    stream = client.get(f"/research/stream/{body['run_id']}")
    assert stream.status_code == 200
    types = [
        __import__("json").loads(line[6:])["type"]
        for line in stream.text.splitlines()
        if line.startswith("data: ") and line[6:] != "[DONE]"
    ]
    assert "usage" in types
    assert types.index("usage") < types.index("complete")
