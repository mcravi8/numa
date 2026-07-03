"""Offline tests for the clarifier gate (app/research/clarifier.py) and its wiring
into both doors (/skills/propose, /numa/research).

Every test mocks the Anthropic client — no live Claude call. The clarifier is
biased silent + fail-open: a clear objective (or any failure) asks nothing and
planning proceeds; a vague one may return ≤3 questions. Answers fold into the
planner/propose prompt, which we assert on the mocked client's recorded calls.
"""
import json

from fastapi.testclient import TestClient

import app.research.clarifier as clarifier_mod
from app.research import clarifier
from app.research.planner import build_plan
from app.research.schemas import Clarification
from main import app

client = TestClient(app)


def _clarify_json(n=2, suggestions=("a", "b")):
    qs = [{"id": "ignored", "text": f"Question {i + 1}?",
           "suggestions": list(suggestions), "suggested_answer": "a"} for i in range(n)]
    return json.dumps({"clarify": True, "questions": qs})


# ============================================================
# === clarify(): shape, caps, fail-open, kill-switch ===
# ============================================================

def test_specific_objective_asks_nothing(fake_anthropic, make_msg):
    # A clear objective: the (mocked) model returns clarify:false → no questions.
    c = fake_anthropic(create_fn=lambda kw: make_msg('{"clarify":false,"questions":[]}'))
    assert clarifier.clarify("What is AAPL's P/E ratio?", ["AAPL"], client=c) == {
        "clarify": False, "questions": []}


def test_vague_objective_capped_and_shaped(fake_anthropic, make_msg):
    # Five questions come back; the gate caps to 3, renumbers ids q1..q3, and each
    # keeps 2–4 concrete suggestions.
    c = fake_anthropic(create_fn=lambda kw: make_msg(_clarify_json(n=5, suggestions=("x", "y", "z"))))
    out = clarifier.clarify("do a deep dive", ["AAPL"], client=c)
    assert out["clarify"] is True
    assert 1 <= len(out["questions"]) <= 3
    for i, q in enumerate(out["questions"]):
        assert q["id"] == f"q{i + 1}"
        assert q["text"]
        assert 2 <= len(q["suggestions"]) <= 4


def test_suggestions_capped_to_four(fake_anthropic, make_msg):
    raw = json.dumps({"clarify": True, "questions": [
        {"text": "Q?", "suggestions": ["a", "b", "c", "d", "e", "f"], "suggested_answer": ""}]})
    c = fake_anthropic(create_fn=lambda kw: make_msg(raw))
    out = clarifier.clarify("vague objective", client=c)
    assert len(out["questions"][0]["suggestions"]) == 4


def test_malformed_json_is_silent(fake_anthropic, make_msg):
    c = fake_anthropic(create_fn=lambda kw: make_msg("this is not json {{{"))
    assert clarifier.clarify("anything", ["AAPL"], client=c) == {"clarify": False, "questions": []}


def test_clarify_true_but_no_valid_questions_is_silent(fake_anthropic, make_msg):
    # clarify:true with an empty / junk question list has nothing to ask → silent.
    c = fake_anthropic(create_fn=lambda kw: make_msg('{"clarify":true,"questions":[{"text":""}]}'))
    assert clarifier.clarify("vague", ["AAPL"], client=c)["clarify"] is False


def test_kill_switch_bypasses_without_a_call(monkeypatch, fake_anthropic, make_msg):
    monkeypatch.setattr(clarifier_mod, "NUMA_CLARIFIER", False)
    calls = {"n": 0}

    def cf(kw):
        calls["n"] += 1
        return make_msg(_clarify_json())

    out = clarifier.clarify("do a deep dive", ["AAPL"], client=fake_anthropic(create_fn=cf))
    assert out == {"clarify": False, "questions": []}
    assert calls["n"] == 0  # kill-switch short-circuits before any model call


def test_no_api_key_is_silent_without_a_call(fake_anthropic, make_msg):
    calls = {"n": 0}

    def cf(kw):
        calls["n"] += 1
        return make_msg(_clarify_json())

    c = fake_anthropic(create_fn=cf, api_key="")
    assert clarifier.clarify("do a deep dive", ["AAPL"], client=c)["clarify"] is False
    assert calls["n"] == 0


# ============================================================
# === format_clarifications(): the prompt block ===
# ============================================================

def test_format_clarifications_omits_skips_and_folds_answers():
    block = clarifier.format_clarifications([
        {"question": "Time horizon?", "answer": "12 months"},
        {"question": "Skipped one?", "answer": ""},          # empty answer = skip → omitted
        Clarification(question="Focus?", answer="margins"),  # model object works too
    ])
    assert block.startswith("User clarifications:")
    assert "Time horizon?" in block and "12 months" in block
    assert "Focus?" in block and "margins" in block
    assert "Skipped one?" not in block
    assert clarifier.format_clarifications([]) == ""  # nothing answered → no block


def test_build_plan_folds_clarifications_into_prompt(fake_anthropic, make_msg):
    plan_json = '{"subtasks":[{"name":"technicals","description":"x","depends_on":[]}]}'
    c = fake_anthropic(create_fn=lambda kw: make_msg(plan_json))
    build_plan("assess momentum", ["AAPL"], client=c,
               clarifications="User clarifications:\n- Q: Horizon?\n  A: 6 months")
    user = c.messages.create_calls[-1]["messages"][0]["content"]
    assert "User clarifications:" in user and "6 months" in user


# ============================================================
# === Door (a): /skills/propose — ask then draft ===
# ============================================================

_PROPOSE_PLAN = json.dumps({"name": "Deep Dive", "subtasks": [
    {"name": "financials", "description": "pull the financials", "depends_on": []},
    {"name": "reason", "description": "summarize", "depends_on": ["financials"]}]})


def _propose_client(fake_anthropic, make_msg, clar_raw):
    """Route the clarifier call (system says 'clarifying') vs the propose call."""
    def cf(kw):
        return make_msg(clar_raw if "clarifying" in kw.get("system", "") else _PROPOSE_PLAN)
    return fake_anthropic(create_fn=cf)


def test_propose_asks_then_drafts_with_answers(patch_research, fake_anthropic, make_msg):
    clar = json.dumps({"clarify": True, "questions": [
        {"text": "What should the skill focus on?", "suggestions": ["margins", "growth"],
         "suggested_answer": "margins"}]})
    c = patch_research(_propose_client(fake_anthropic, make_msg, clar))

    r1 = client.post("/skills/propose", json={"description": "analyze the company", "tickers": ["AAPL"]})
    b1 = r1.json()
    assert b1.get("clarify") is True and len(b1["questions"]) >= 1
    q = b1["questions"][0]
    assert q["id"] == "q1" and 2 <= len(q["suggestions"]) <= 4

    r2 = client.post("/skills/propose", json={
        "description": "analyze the company", "tickers": ["AAPL"], "clarified": True,
        "clarifications": [{"question": q["text"], "answer": "margins and free cash flow"}]})
    b2 = r2.json()
    assert "questions" not in b2 and b2["plan"]["subtasks"]  # a draft, not more questions
    users = [k["messages"][0]["content"] for k in c.messages.create_calls]
    assert any("margins and free cash flow" in u for u in users)  # answer reached the prompt


def test_propose_skip_all_proceeds(patch_research, fake_anthropic, make_msg):
    patch_research(_propose_client(fake_anthropic, make_msg, _clarify_json()))
    # clarified=true with no answers (skip-all) → straight to a draft, no re-ask.
    r = client.post("/skills/propose", json={
        "description": "analyze the company", "tickers": ["AAPL"],
        "clarified": True, "clarifications": []})
    b = r.json()
    assert "questions" not in b and b["plan"]["subtasks"]


def test_propose_malformed_clarifier_proceeds(patch_research, fake_anthropic, make_msg):
    # The clarifier returns junk → fail-open → draft directly on the first POST.
    patch_research(_propose_client(fake_anthropic, make_msg, "garbage {{{"))
    r = client.post("/skills/propose", json={"description": "analyze the company", "tickers": ["AAPL"]})
    b = r.json()
    assert "questions" not in b and b["plan"]["subtasks"]


# ============================================================
# === Door (b): /numa/research — clarify between deploy + planner ===
# ============================================================

def test_numa_research_clarify_then_deploy(patch_research, fake_anthropic, make_msg):
    clar = json.dumps({"clarify": True, "questions": [
        {"text": "Which angle?", "suggestions": ["bull", "bear", "both"], "suggested_answer": ""}]})
    plan = json.dumps({"subtasks": [
        {"name": "technicals", "description": "pull", "depends_on": []},
        {"name": "reason", "description": "tie", "depends_on": ["technicals"]}]})

    def cf(kw):
        s = kw.get("system", "")
        if "DIRECT or RESEARCH" in s:
            return make_msg("RESEARCH")
        if "clarifying" in s:
            return make_msg(clar)
        return make_msg(plan)

    c = patch_research(fake_anthropic(create_fn=cf, stream_tokens=("done.",)))
    q = "Compare AAPL and MSFT on growth and valuation"

    r1 = client.post("/numa/research", json={"question": q, "tickers": ["AAPL", "MSFT"]})
    b1 = r1.json()
    assert b1["deploy"] is False and b1.get("clarify") is True and b1["questions"]

    r2 = client.post("/numa/research", json={
        "question": q, "tickers": ["AAPL", "MSFT"], "clarified": True,
        "clarifications": [{"question": "Which angle?", "answer": "bull and bear both"}]})
    b2 = r2.json()
    assert b2["deploy"] is True and b2["run_id"] and b2["plan"]["subtasks"]
    users = [k["messages"][0]["content"] for k in c.messages.create_calls]
    assert any("bull and bear both" in u for u in users)  # answer reached the planner


def test_numa_research_no_clarify_deploys_directly(patch_research, fake_anthropic, make_msg):
    plan = json.dumps({"subtasks": [{"name": "technicals", "description": "pull", "depends_on": []}]})

    def cf(kw):
        s = kw.get("system", "")
        if "DIRECT or RESEARCH" in s:
            return make_msg("RESEARCH")
        if "clarifying" in s:
            return make_msg('{"clarify":false,"questions":[]}')
        return make_msg(plan)

    patch_research(fake_anthropic(create_fn=cf, stream_tokens=("done.",)))
    r = client.post("/numa/research", json={
        "question": "Compare AAPL and MSFT on growth and valuation", "tickers": ["AAPL", "MSFT"]})
    b = r.json()
    assert b["deploy"] is True and b["run_id"]  # clarifier silent → deploy in one shot
