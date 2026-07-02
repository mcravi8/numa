#!/usr/bin/env python3
"""Record AAPL fixtures for the offline per-module tests.

Fetches AAPL **once** via yfinance and serializes everything the transformer
modules consume into ``tests/fixtures/`` — pandas objects as pickle, dicts/lists
as JSON. The offline tests (``tests/test_modules.py`` via the ``FakeTicker`` in
``tests/conftest.py``) replay these so CI exercises the data modules without a
network call.

Run once and commit the result (use the python3.11 runtime, see CLAUDE.md):

    python3.11 scripts/record_fixtures.py

Re-run to refresh; the underlying values will drift (it's live data), which is
fine — the tests assert shapes/types, not exact numbers. Keep the total under
~2 MB; if it grows past that, drop ``HISTORY_PERIOD`` to "2y" or "1y".

Fetchers (insider, news, peers, congress) make their own external calls and stay
network-only, so nothing is recorded for them here.
"""
import json
import pickle
import sys
from pathlib import Path

import yfinance as yf

# app.utils._json_safe coerces numpy scalars / NaN → JSON-native, so the info
# and fast_info dicts serialize cleanly and faithfully.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.utils import _json_safe  # noqa: E402

TICKER = "AAPL"
FIX = Path(__file__).resolve().parent.parent / "tests" / "fixtures"
HISTORY_PERIOD = "5y"  # drop to "2y"/"1y" if the fixtures exceed ~2 MB
MAX_TOTAL_BYTES = 2_000_000


def _dump_json(name: str, obj) -> None:
    (FIX / name).write_text(
        json.dumps(_json_safe(obj), default=str, separators=(",", ":"))
    )


def _dump_pickle(name: str, obj) -> None:
    with open(FIX / name, "wb") as f:
        pickle.dump(obj, f, protocol=4)


def _safe(fn, default=None):
    """yfinance properties can raise or be missing; record None on failure so
    the FakeTicker mirrors the real 'nothing there' case."""
    try:
        return fn()
    except Exception as e:
        print(f"  (warning: {e})", file=sys.stderr)
        return default


def main() -> int:
    FIX.mkdir(parents=True, exist_ok=True)
    t = yf.Ticker(TICKER)

    # --- dicts → JSON ---
    _dump_json("info.json", dict(t.info))
    fi = t.fast_info
    fast = {}
    for k in list(fi.keys()):
        fast[k] = _safe(lambda k=k: fi[k])
    _dump_json("fast_info.json", fast)
    _dump_json("options.json", list(t.options[:4]))

    # --- pandas objects → pickle ---
    _dump_pickle("history.pkl", t.history(period=HISTORY_PERIOD, interval="1d"))
    _dump_pickle("income_stmt.pkl", t.income_stmt)
    _dump_pickle("balance_sheet.pkl", t.balance_sheet)

    chains = {}
    for exp in list(t.options[:4]):
        oc = t.option_chain(exp)
        chains[exp] = {"calls": oc.calls, "puts": oc.puts}
    _dump_pickle("option_chains.pkl", chains)

    _dump_pickle("earnings_history.pkl", _safe(lambda: t.earnings_history))
    _dump_pickle("calendar.pkl", _safe(lambda: t.calendar))
    _dump_pickle("earnings_dates.pkl", _safe(lambda: t.get_earnings_dates(limit=28)))
    _dump_pickle("recommendations.pkl", _safe(lambda: t.recommendations))
    _dump_pickle("upgrades_downgrades.pkl", _safe(lambda: t.upgrades_downgrades))

    # --- size report ---
    total = 0
    print(f"Fixtures written to {FIX} (history={HISTORY_PERIOD}):")
    for p in sorted(FIX.iterdir()):
        if p.is_file():
            sz = p.stat().st_size
            total += sz
            print(f"  {p.name:26s} {sz / 1024:8.1f} KB")
    print(f"  {'TOTAL':26s} {total / 1024:8.1f} KB")
    if total > MAX_TOTAL_BYTES:
        print(
            f"ERROR: fixtures are {total / 1024:.0f} KB (> ~2 MB). "
            "Lower HISTORY_PERIOD and re-run.",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
