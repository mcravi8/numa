"""Smoke tests for the Research Terminal core endpoints.

These exercise the FastAPI app in ``main.py`` through Starlette's ``TestClient``
(no running server needed). They are the safety net for the incremental refactor
described in ``docs/REFACTOR_PLAN.md``: every later step must keep them green.

Run:                    pytest
Offline / no internet:  pytest -m "not network"   (or set OFFLINE=1)

Tests marked ``@pytest.mark.network`` hit live Yahoo Finance and are
auto-skipped when there is no connectivity (see ``tests/conftest.py``).
"""
import pytest
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def test_health_returns_ok():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_root_returns_html():
    r = client.get("/")
    assert r.status_code == 200
    assert "text/html" in r.headers["content-type"].lower()
    assert "<html" in r.text.lower()


def test_notes_get_returns_list():
    r = client.get("/notes")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


@pytest.mark.network
def test_analyze_aapl_returns_populated_payload():
    r = client.get("/analyze/AAPL")
    assert r.status_code == 200
    data = r.json()
    for key in ("ticker", "quote", "financials", "technicals"):
        assert key in data, f"missing key: {key}"
    assert data["ticker"] == "AAPL"
    assert data["error"] is None
    # The named modules should have produced data bags, not error bags.
    for key in ("quote", "financials", "technicals"):
        assert isinstance(data[key], dict), f"{key} is not a dict"
        assert "error" not in data[key], f"{key} returned an error bag: {data[key].get('error')}"


@pytest.mark.network
def test_quote_aapl_returns_price():
    r = client.get("/quote/AAPL")
    assert r.status_code == 200
    data = r.json()
    assert data.get("price") is not None
    assert isinstance(data["price"], (int, float))
