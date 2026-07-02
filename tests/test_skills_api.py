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
    many = {"subtasks": [{"name": "reason", "description": f"step {i}", "depends_on": []}
                         for i in range(20)]}
    patch_research(fake_anthropic(create_fn=lambda kw: make_msg(json.dumps(many))))

    draft = client.post("/skills/propose", json={"description": "huge pipeline"}).json()
    assert len(draft["plan"]["subtasks"]) == 8       # SKILL_MAX_SUBTASKS
