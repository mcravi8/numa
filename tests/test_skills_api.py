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
        {"name": "reason", "description": f"step {i}", "depends_on": []} for i in range(20)]}
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


def test_propose_derives_name_when_model_omits_it(
    tmp_skills, patch_research, fake_anthropic, make_msg,
):
    # Model returns only subtasks — the route derives a Title-Case fallback name.
    out = {"subtasks": [{"name": "technicals", "description": "chart {ticker}", "depends_on": []}]}
    patch_research(fake_anthropic(create_fn=lambda kw: make_msg(json.dumps(out))))
    draft = client.post("/skills/propose", json={"description": "momentum screen"}).json()
    assert draft["name"] == "Momentum Screen"


def test_propose_generalizes_request_tickers(
    tmp_skills, patch_research, fake_anthropic, make_msg,
):
    # Model leaks a concrete ticker into the name AND a step description.
    model_out = {"name": "AAPL Momentum", "subtasks": [
        {"name": "technicals", "description": "Fetch AAPL technicals and momentum", "depends_on": []},
    ]}
    patch_research(fake_anthropic(create_fn=lambda kw: make_msg(json.dumps(model_out))))

    draft = client.post(
        "/skills/propose", json={"description": "momentum check", "tickers": ["AAPL"]},
    ).json()

    step_desc = draft["plan"]["subtasks"][0]["description"]
    assert "AAPL" not in step_desc and "{ticker}" in step_desc
    assert "AAPL" not in draft["name"] and "{ticker}" in draft["name"]  # "AAPL Momentum" → "{ticker} Momentum"


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
