"""Offline smoke tests for the research HTTP + SSE endpoints.

Everything runs through Starlette's TestClient with the research engine wired
offline by the ``patch_research`` fixture (mocked Anthropic client + recorded
FakeTicker) — **no live Claude call, no network**.
"""
import json

from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def _sse_events(text):
    """Parse an SSE body into (list of parsed JSON events, saw_done)."""
    events, saw_done = [], False
    for line in text.splitlines():
        if not line.startswith("data: "):
            continue
        payload = line[len("data: "):]
        if payload == "[DONE]":
            saw_done = True
            continue
        events.append(json.loads(payload))
    return events, saw_done


# ============================================================
# === /research/plan ===
# ============================================================

def test_plan_returns_valid_schema(patch_research, fake_anthropic, make_msg):
    plan_json = {
        "subtasks": [
            {"name": "technicals", "description": "read the chart", "depends_on": []},
            {"name": "reason", "description": "verdict", "depends_on": ["technicals"]},
        ]
    }
    patch_research(fake_anthropic(create_fn=lambda kw: make_msg(json.dumps(plan_json))))

    r = client.post("/research/plan", json={"objective": "momentum on AAPL", "tickers": ["AAPL"]})
    assert r.status_code == 200
    body = r.json()
    assert "subtasks" in body and isinstance(body["subtasks"], list)
    assert [s["name"] for s in body["subtasks"]] == ["technicals", "reason"]
    for st in body["subtasks"]:  # AO's verbatim subtask shape
        assert set(st.keys()) == {"name", "description", "depends_on"}


def test_plan_degrades_on_bad_model_output(patch_research, fake_anthropic, make_msg):
    patch_research(fake_anthropic(create_fn=lambda kw: make_msg("not json {{{")))
    r = client.post("/research/plan", json={"objective": "understand TSLA", "tickers": ["TSLA"]})
    assert r.status_code == 200
    body = r.json()
    assert len(body["subtasks"]) == 1
    assert body["subtasks"][0]["name"] == "reason"


# ============================================================
# === /research/run + /research/stream ===
# ============================================================

def test_run_then_stream_full_event_sequence(patch_research, fake_anthropic, make_msg):
    patch_research(fake_anthropic(
        create_fn=lambda kw: make_msg("technical read"),
        stream_tokens=("Bottom line: ", "constructive."),
    ))

    plan = {"subtasks": [
        {"name": "technicals", "description": "pull technicals", "depends_on": []},
        {"name": "reason", "description": "verdict", "depends_on": ["technicals"]},
    ]}
    run = client.post("/research/run", json={"plan": plan, "tickers": ["AAPL"],
                                             "objective": "quick read"})
    assert run.status_code == 200
    run_id = run.json()["run_id"]
    assert run_id

    r = client.get(f"/research/stream/{run_id}")
    assert r.status_code == 200
    assert "text/event-stream" in r.headers["content-type"]

    events, saw_done = _sse_events(r.text)
    assert saw_done, "stream must end with [DONE]"

    types = [e["type"] for e in events]
    assert types[0] == "plan"
    assert types[-1] == "complete"
    assert "subtask_started" in types and "subtask_completed" in types
    assert "synthesis_token" in types

    # The fetch subtask injected real (recorded) module data.
    tech = next(e for e in events
                if e["type"] == "subtask_completed" and e["name"] == "technicals")
    assert "AAPL" in tech["data"] and "rsi" in tech["data"]["AAPL"]

    # Synthesis tokens concatenate into the complete event.
    synth = "".join(e["token"] for e in events if e["type"] == "synthesis_token")
    assert synth == "Bottom line: constructive."
    assert events[-1]["synthesis"] == synth


def test_run_id_is_single_use(patch_research, fake_anthropic, make_msg):
    patch_research(fake_anthropic())
    plan = {"subtasks": [{"name": "reason", "description": "x", "depends_on": []}]}
    run_id = client.post("/research/run", json={"plan": plan, "tickers": ["AAPL"]}).json()["run_id"]

    first = client.get(f"/research/stream/{run_id}")
    assert first.status_code == 200
    events, _ = _sse_events(first.text)
    assert events[-1]["type"] == "complete"

    # Second consumption of the same id is unknown → clean error event.
    second = client.get(f"/research/stream/{run_id}")
    events2, saw_done2 = _sse_events(second.text)
    assert saw_done2
    assert events2 == [{"type": "error", "error": f"unknown or expired run_id: {run_id}"}]


def test_unknown_run_id_clean_sse_error():
    r = client.get("/research/stream/does-not-exist")
    assert r.status_code == 200
    assert "text/event-stream" in r.headers["content-type"]
    events, saw_done = _sse_events(r.text)
    assert saw_done
    assert len(events) == 1 and events[0]["type"] == "error"
    assert "does-not-exist" in events[0]["error"]
