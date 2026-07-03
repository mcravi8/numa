"""Offline tests for the skills persistence + propose endpoints.

CRUD runs against a ``tmp_path`` skills file (SKILLS_FILE monkeypatched), so the
real repo-root skills.json is never touched. Propose uses the mocked Anthropic
client (patch_research) — **no live Claude call, no network**.
"""
import json

import pytest
from fastapi.testclient import TestClient

import app.routes.skills as skills_mod
from main import app

client = TestClient(app)


@pytest.fixture
def tmp_skills(monkeypatch, tmp_path):
    """Point the skills store at a throwaway file for the duration of a test."""
    f = tmp_path / "skills.json"
    monkeypatch.setattr(skills_mod, "SKILLS_FILE", f)
    return f


_PLAN = {"subtasks": [
    {"name": "technicals", "description": "chart for {ticker}", "depends_on": []},
    {"name": "reason", "description": "verdict on {ticker}", "depends_on": ["technicals"]},
]}


# ============================================================
# === CRUD ===
# ============================================================

def test_skills_crud_roundtrip(tmp_skills):
    # Empty to start.
    assert client.get("/skills").json() == []

    # CREATE → server assigns a uuid id, version 1.
    created = client.post("/skills", json={
        "name": "Momentum read", "description": "quick technical take", "plan": _PLAN,
    })
    assert created.status_code == 200
    skill = created.json()
    sid = skill["id"]
    assert sid and len(sid) == 32          # uuid4().hex
    assert skill["version"] == 1
    assert [s["name"] for s in skill["plan"]["subtasks"]] == ["technicals", "reason"]

    # READ back.
    listed = client.get("/skills").json()
    assert len(listed) == 1 and listed[0]["id"] == sid

    # UPDATE → version bumps, fields change, id preserved.
    edited = client.put(f"/skills/{sid}", json={
        "name": "Momentum read v2", "description": "edited", "plan": _PLAN,
    })
    assert edited.status_code == 200
    assert edited.json()["version"] == 2
    assert edited.json()["name"] == "Momentum read v2"
    assert edited.json()["id"] == sid

    # Persisted edit visible + written to the tmp file.
    assert client.get("/skills").json()[0]["version"] == 2
    on_disk = json.loads(tmp_skills.read_text())
    assert len(on_disk) == 1 and on_disk[0]["name"] == "Momentum read v2"

    # DELETE → gone.
    assert client.delete(f"/skills/{sid}").json() == {"ok": True, "id": sid}
    assert client.get("/skills").json() == []


def test_create_returns_id_and_get_reflects_it(tmp_skills):
    # The contract the frontend's save→refresh relies on: POST returns the created
    # skill's id, and an immediate GET /skills includes exactly that skill. If this
    # holds, the list can never render empty right after a successful save.
    created = client.post("/skills", json={"name": "Refresh me", "description": "", "plan": _PLAN})
    assert created.status_code == 200
    sid = created.json()["id"]
    assert sid                              # a truthy id is returned
    listed = client.get("/skills").json()
    assert [s["id"] for s in listed] == [sid]
    assert listed[0]["name"] == "Refresh me"


def test_put_unknown_id_404(tmp_skills):
    r = client.put("/skills/nope", json={"name": "x", "description": "", "plan": _PLAN})
    assert r.status_code == 404


def test_delete_unknown_id_404(tmp_skills):
    assert client.delete("/skills/nope").status_code == 404


# ============================================================
# === PROPOSE ===
# ============================================================

def test_propose_returns_valid_unsaved_draft(tmp_skills, patch_research, fake_anthropic, make_msg):
    patch_research(fake_anthropic(create_fn=lambda kw: make_msg(json.dumps(_PLAN))))

    r = client.post("/skills/propose", json={"description": "momentum screen"})
    assert r.status_code == 200
    draft = r.json()

    assert draft["id"] is None                       # unsaved draft
    assert draft["version"] == 1
    assert draft["description"] == "momentum screen"
    assert [s["name"] for s in draft["plan"]["subtasks"]] == ["technicals", "reason"]

    # Proposing does NOT persist — the store stays empty.
    assert client.get("/skills").json() == []


def test_propose_enforces_skill_cap(tmp_skills, patch_research, fake_anthropic, make_msg):
    many = {"name": "Big One", "subtasks": [
        {"name": "earnings", "description": f"step {i}", "depends_on": []} for i in range(20)]}
    patch_research(fake_anthropic(create_fn=lambda kw: make_msg(json.dumps(many))))

    draft = client.post("/skills/propose", json={"description": "huge pipeline"}).json()
    assert len(draft["plan"]["subtasks"]) == 8       # SKILL_MAX_SUBTASKS


def test_propose_returns_short_name_distinct_from_description(
    tmp_skills, patch_research, fake_anthropic, make_msg,
):
    model_out = {"name": "Earnings Deep Dive", "subtasks": [
        {"name": "earnings", "description": "Fetch {ticker} earnings history", "depends_on": []},
        {"name": "reason", "description": "Assess the setup for {ticker}", "depends_on": ["earnings"]},
    ]}
    patch_research(fake_anthropic(create_fn=lambda kw: make_msg(json.dumps(model_out))))

    desc = "look at the last several quarters of earnings and whether the setup is favorable"
    draft = client.post("/skills/propose", json={"description": desc}).json()

    assert draft["name"] == "Earnings Deep Dive"     # short label from the model
    assert draft["name"] != draft["description"]     # not the raw sentence
    assert len(draft["name"]) <= 40
    assert draft["description"] == desc              # user's text becomes the description


def test_propose_derives_name_from_tools_when_model_omits_it(
    tmp_skills, patch_research, fake_anthropic, make_msg,
):
    # Model returns only subtasks — the fallback name comes from the plan's TOOLS,
    # never a truncated sentence.
    out = {"subtasks": [{"name": "technicals", "description": "chart ACME", "depends_on": []}]}
    patch_research(fake_anthropic(create_fn=lambda kw: make_msg(json.dumps(out))))
    draft = client.post("/skills/propose", json={"description": "momentum screen"}).json()
    assert draft["name"] == "Technicals Review"


def test_propose_generalizes_request_tickers(
    tmp_skills, patch_research, fake_anthropic, make_msg,
):
    # Model leaks a request ticker into the name AND a step description. The name
    # residue forces a clean tool-derived name; the step is hard-scrubbed.
    model_out = {"name": "AAPL Momentum", "subtasks": [
        {"name": "technicals", "description": "Fetch AAPL technicals and momentum", "depends_on": []},
    ]}
    patch_research(fake_anthropic(create_fn=lambda kw: make_msg(json.dumps(model_out))))

    draft = client.post(
        "/skills/propose", json={"description": "momentum check", "tickers": ["AAPL"]},
    ).json()

    step_desc = draft["plan"]["subtasks"][0]["description"]
    assert "AAPL" not in step_desc and "{ticker}" in step_desc
    assert draft["name"] == "Technicals Review"   # ticker-in-name → tool-derived label


def test_propose_generalizes_dollar_symbol_in_description(
    tmp_skills, patch_research, fake_anthropic, make_msg,
):
    # No tickers list — the $NVDA in the description drives generalization.
    model_out = {"name": "Deep Dive", "subtasks": [
        {"name": "earnings", "description": "Fetch NVDA earnings and $NVDA options", "depends_on": []},
    ]}
    patch_research(fake_anthropic(create_fn=lambda kw: make_msg(json.dumps(model_out))))

    draft = client.post("/skills/propose", json={"description": "study $NVDA in depth"}).json()
    step_desc = draft["plan"]["subtasks"][0]["description"]
    assert "NVDA" not in step_desc
    assert step_desc == "Fetch {ticker} earnings and {ticker} options"


def test_propose_then_render_for_msft_has_no_aapl(
    tmp_skills, patch_research, fake_anthropic, make_msg,
):
    from app.research.schemas import Plan, render_plan

    model_out = {"name": "AAPL Earnings", "subtasks": [
        {"name": "earnings", "description": "Fetch AAPL earnings history", "depends_on": []},
        {"name": "reason", "description": "Assess AAPL setup", "depends_on": ["earnings"]},
    ]}
    patch_research(fake_anthropic(create_fn=lambda kw: make_msg(json.dumps(model_out))))

    draft = client.post(
        "/skills/propose", json={"description": "earnings deep dive", "tickers": ["AAPL"]},
    ).json()

    # Draft was generalized to {ticker}; resolving it for MSFT yields MSFT, no AAPL.
    rendered = render_plan(Plan(**draft["plan"]), "MSFT")
    blob = json.dumps(rendered.model_dump())
    assert "AAPL" not in blob
    assert "MSFT" in blob


# ============================================================
# === PROPOSE — invert-the-substitution (adversarial) ===
# ============================================================
# These encode the degenerate shapes the REAL model actually returned (which the
# earlier {ticker}-instruction mock never exercised): a concrete subject in every
# step, a refusal ("no ticker provided") single-reason plan, a missing name, and
# name == description. The pipeline must plan against a concrete example ticker
# and recover deterministically.


def test_propose_plans_against_example_ticker_and_inverts(
    tmp_skills, patch_research, fake_anthropic, make_msg,
):
    seen = {}

    def create_fn(kw):
        seen["user"] = kw["messages"][0]["content"]
        # A well-behaved model plans for the concrete example subject it was given.
        return make_msg(json.dumps({"name": "Earnings And Options Review", "subtasks": [
            {"name": "earnings", "description": "Fetch ACME earnings history and beat rate", "depends_on": []},
            {"name": "options_flow", "description": "Assess ACME options flow into the print", "depends_on": []},
            {"name": "reason", "description": "Weigh ACME setup and name the risk", "depends_on": ["earnings", "options_flow"]},
        ]}))

    patch_research(fake_anthropic(create_fn=create_fn))
    draft = client.post(
        "/skills/propose",
        json={"description": "For $AAPL: earnings and options into the report", "tickers": ["AAPL"]},
    ).json()

    # (1) the model planned against ACME — never the user's real symbol.
    assert "ACME" in seen["user"]
    assert "AAPL" not in seen["user"]
    # (2) deterministic inversion: ACME and the real symbol are gone, {ticker} is in.
    steps = draft["plan"]["subtasks"]
    joined = draft["name"] + " " + " ".join(s["description"] for s in steps)
    assert "ACME" not in joined and "AAPL" not in joined
    assert all("{ticker}" in s["description"] for s in steps)
    assert draft["name"] == "Earnings And Options Review"


def test_propose_retries_once_then_recovers(
    tmp_skills, patch_research, fake_anthropic, make_msg,
):
    calls = {"n": 0}

    def create_fn(kw):
        calls["n"] += 1
        if calls["n"] == 1:
            # Observed refusal shape: no name, single reason step "no ticker".
            return make_msg(json.dumps({"subtasks": [
                {"name": "reason", "description": "No ticker was provided, cannot proceed", "depends_on": []}]}))
        # Retry returns a proper plan + clean name.
        return make_msg(json.dumps({"name": "Earnings Setup Review", "subtasks": [
            {"name": "earnings", "description": "Fetch ACME earnings history", "depends_on": []},
            {"name": "reason", "description": "Assess ACME setup", "depends_on": ["earnings"]}]}))

    patch_research(fake_anthropic(create_fn=create_fn))
    draft = client.post("/skills/propose", json={"description": "earnings and options setup"}).json()

    assert calls["n"] == 2                                    # retried exactly once
    assert draft["name"] == "Earnings Setup Review"
    assert any(s["name"] == "earnings" for s in draft["plan"]["subtasks"])
    assert all("ACME" not in s["description"] for s in draft["plan"]["subtasks"])


def test_propose_falls_back_to_tool_name_when_model_keeps_failing(
    tmp_skills, patch_research, fake_anthropic, make_msg,
):
    # Model always echoes the description as the name (name == description). The
    # plan is fine, so recovery = derive the name from the plan's tools.
    desc = "look at earnings history and what options flow implies for the coming report"

    def create_fn(kw):
        return make_msg(json.dumps({"name": desc, "subtasks": [
            {"name": "earnings", "description": "Fetch ACME earnings history", "depends_on": []},
            {"name": "options_flow", "description": "Assess ACME options flow", "depends_on": []},
            {"name": "reason", "description": "Synthesize ACME", "depends_on": ["earnings", "options_flow"]}]}))

    patch_research(fake_anthropic(create_fn=create_fn))
    draft = client.post("/skills/propose", json={"description": desc}).json()

    assert draft["name"] == "Earnings + Options Flow Review"  # from tools, not the sentence
    assert draft["name"] != desc and len(draft["name"]) <= 40
    assert not desc.lower().startswith(draft["name"].lower())


def test_propose_recovers_from_refusal_single_reason_plan(
    tmp_skills, patch_research, fake_anthropic, make_msg,
):
    # Model returns ONLY the refusal every time — pipeline must not surface the
    # refusal text as the name, and must produce a clean, short label.
    def create_fn(kw):
        return make_msg(json.dumps({"name": "No ticker was provided", "subtasks": [
            {"name": "reason", "description": "No ticker was provided, cannot plan", "depends_on": []}]}))

    patch_research(fake_anthropic(create_fn=create_fn))
    draft = client.post("/skills/propose", json={"description": "earnings and news read"}).json()

    assert "no ticker" not in draft["name"].lower()
    assert draft["name"] != draft["description"]
    assert 0 < len(draft["name"]) <= 40


# ============================================================
# === PROPOSE — model-led company recognition + residue check ===
# ============================================================

def _residue_free(draft) -> bool:
    """No identity residue in the draft's name + step descriptions: no $-token,
    no leftover ACME, no {braced} token other than {ticker}."""
    import re
    blob = draft["name"] + " " + " ".join(s["description"] for s in draft["plan"]["subtasks"])
    if re.search(r"\$[A-Za-z]", blob):
        return False
    if "acme" in blob.lower():
        return False
    return all(b == "{ticker}" for b in re.findall(r"\{[^{}]*\}", blob))


# A well-behaved model plans against the concrete stand-in it was handed.
_CLEAN_ACME = {"name": "Earnings And News Review", "subtasks": [
    {"name": "earnings", "description": "Fetch ACME earnings history and beat rate", "depends_on": []},
    {"name": "news_sentiment", "description": "Assess recent ACME news sentiment", "depends_on": []},
    {"name": "reason", "description": "Synthesize ACME earnings and news into a call", "depends_on": ["earnings", "news_sentiment"]},
]}


@pytest.mark.parametrize("description", [
    "apple: earnings and news",
    "Apple Inc. earnings and news",
    "aapl earnings and news",
    "$aapl earnings and news",
    "{AAPL} earnings and news",
    "earnings and news deep dive",   # no company mentioned at all
])
def test_propose_any_company_form_yields_ticker_placeholder(
    description, tmp_skills, patch_research, fake_anthropic, make_msg,
):
    # Whatever form the company takes (name/symbol/casing/wrapping/none), the
    # draft comes back with {ticker} in every step and zero identity residue.
    patch_research(fake_anthropic(create_fn=lambda kw: make_msg(json.dumps(_CLEAN_ACME))))
    draft = client.post("/skills/propose", json={"description": description}).json()

    steps = draft["plan"]["subtasks"]
    assert all("{ticker}" in s["description"] for s in steps)
    assert _residue_free(draft)
    assert draft["description"] == description   # user's text preserved verbatim


def test_propose_retries_when_output_leaks_company(
    tmp_skills, patch_research, fake_anthropic, make_msg,
):
    calls = {"n": 0}

    def create_fn(kw):
        calls["n"] += 1
        if calls["n"] == 1:
            # Leaks the company: name says "Apple", a step carries "$AAPL".
            return make_msg(json.dumps({"name": "Apple Deep Dive", "subtasks": [
                {"name": "earnings", "description": "Fetch $AAPL earnings history for Apple", "depends_on": []}]}))
        return make_msg(json.dumps({"name": "Earnings Deep Dive", "subtasks": [
            {"name": "earnings", "description": "Fetch ACME earnings history", "depends_on": []}]}))

    patch_research(fake_anthropic(create_fn=create_fn))
    draft = client.post(
        "/skills/propose", json={"description": "for apple: earnings", "tickers": ["AAPL"]},
    ).json()

    assert calls["n"] == 2                       # residue triggered exactly one retry
    assert draft["name"] == "Earnings Deep Dive"
    assert _residue_free(draft)
    assert all("{ticker}" in s["description"] for s in draft["plan"]["subtasks"])
