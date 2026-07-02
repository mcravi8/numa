"""Shared pytest hooks and fixtures.

Two things live here:

1. Network gating — tests marked ``@pytest.mark.network`` hit live Yahoo Finance
   (via yfinance) and are **auto-skipped when there is no connectivity**, so the
   suite still passes offline. Force-skip with ``OFFLINE=1``; run only the
   offline-safe tests with ``pytest -m "not network"``.
2. ``FakeTicker`` + fixtures — replay recorded AAPL data (``tests/fixtures/``,
   built by ``scripts/record_fixtures.py``) through the ``yfinance.Ticker``
   surface the transformer modules use, so ``tests/test_modules.py`` exercises
   those modules with no network at all.
"""
import json
import os
import pickle
import socket
from collections import namedtuple
from pathlib import Path

import pytest

# The host yfinance actually talks to; probing it (rather than a generic host)
# means we skip when the *data source* is unreachable, not just the internet.
_PROBE_HOST_PORT = ("query1.finance.yahoo.com", 443)
_online_cache = None


def _has_network(host_port=_PROBE_HOST_PORT, timeout=2.5):
    if os.getenv("OFFLINE", "").strip().lower() in ("1", "true", "yes", "on"):
        return False
    try:
        with socket.create_connection(host_port, timeout=timeout):
            return True
    except OSError:
        return False


def pytest_collection_modifyitems(config, items):
    """Auto-skip network-marked tests when offline (probed once per run)."""
    global _online_cache
    if _online_cache is None:
        _online_cache = _has_network()
    if _online_cache:
        return
    skip = pytest.mark.skip(
        reason="offline: skipping network-dependent test (needs live Yahoo Finance)"
    )
    for item in items:
        if "network" in item.keywords:
            item.add_marker(skip)


# ============================================================
# === RECORDED FIXTURES — offline FakeTicker (no network) ===
# ============================================================

FIXTURES = Path(__file__).parent / "fixtures"

# Mirrors yfinance's option_chain(...) return: a named tuple exposing .calls /
# .puts (the two fields the options module reads) plus .underlying for parity.
_OptionChain = namedtuple("OptionChain", ["calls", "puts", "underlying"])


def _load_json(name):
    return json.loads((FIXTURES / name).read_text())


def _load_pickle(name):
    with open(FIXTURES / name, "rb") as f:
        return pickle.load(f)


class FakeTicker:
    """Serves the recorded AAPL fixtures through the exact ``yfinance.Ticker``
    attribute/method surface the transformer modules touch, with no network.
    See ``scripts/record_fixtures.py`` for what is recorded."""

    def __init__(self):
        self._info = _load_json("info.json")
        self._fast_info = _load_json("fast_info.json")
        self._options = tuple(_load_json("options.json"))
        self._history = _load_pickle("history.pkl")
        self._income_stmt = _load_pickle("income_stmt.pkl")
        self._balance_sheet = _load_pickle("balance_sheet.pkl")
        self._chains = _load_pickle("option_chains.pkl")
        self._earnings_history = _load_pickle("earnings_history.pkl")
        self._calendar = _load_pickle("calendar.pkl")
        self._earnings_dates = _load_pickle("earnings_dates.pkl")
        self._recommendations = _load_pickle("recommendations.pkl")
        self._upgrades_downgrades = _load_pickle("upgrades_downgrades.pkl")

    @property
    def info(self):
        return self._info

    @property
    def fast_info(self):
        return self._fast_info

    @property
    def options(self):
        return self._options

    def history(self, *args, **kwargs):
        return self._history

    @property
    def income_stmt(self):
        return self._income_stmt

    @property
    def balance_sheet(self):
        return self._balance_sheet

    def option_chain(self, expiry):
        c = self._chains[expiry]
        return _OptionChain(calls=c["calls"], puts=c["puts"], underlying={})

    @property
    def earnings_history(self):
        return self._earnings_history

    @property
    def calendar(self):
        return self._calendar

    def get_earnings_dates(self, limit=12):
        return self._earnings_dates

    @property
    def recommendations(self):
        return self._recommendations

    @property
    def upgrades_downgrades(self):
        return self._upgrades_downgrades


@pytest.fixture(scope="session")
def fake_stock():
    """A FakeTicker replaying recorded AAPL fixtures (stands in for yf.Ticker)."""
    return FakeTicker()


@pytest.fixture(scope="session")
def recorded_info():
    """The recorded AAPL .info dict (what the endpoints fetch once and hand down)."""
    return _load_json("info.json")
