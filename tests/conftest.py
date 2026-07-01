"""Shared pytest hooks for the smoke suite.

Network-dependent tests are marked ``@pytest.mark.network``. They hit live
Yahoo Finance (via yfinance) and are **auto-skipped when there is no
connectivity**, so the suite still passes offline. To force-skip regardless of
connectivity set ``OFFLINE=1``; to run only the offline-safe tests use
``pytest -m "not network"``.
"""
import os
import socket

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
