"""Offline per-module tests for the transformer modules.

Each transformer (company, quote, financials, technicals, options, earnings,
ratings) is exercised against recorded AAPL fixtures via the ``FakeTicker`` /
``recorded_info`` fixtures in ``conftest.py`` — **no network**, so these run in
CI (they carry no ``network`` mark, unlike the smoke suite).

The fetchers (insider, news, peers, congress) make their own external calls and
stay covered only by the network-marked smoke tests for now.

Assertions are deliberately about shape and type (dict, no error bag, expected
keys with sane types), not exact values — the recordings are live data and drift
when refreshed by scripts/record_fixtures.py.
"""
from app.modules.company import get_company
from app.modules.earnings import get_earnings
from app.modules.financials import get_financials
from app.modules.options import get_options_flow
from app.modules.quote import get_quote
from app.modules.ratings import get_analyst_ratings
from app.modules.technicals import get_technicals


def _assert_ok(result, expected_keys):
    """A module returned a success bag (dict, no error) with the expected keys."""
    assert isinstance(result, dict), f"expected dict, got {type(result)}"
    assert "error" not in result, f"module returned an error bag: {result.get('error')}"
    for key in expected_keys:
        assert key in result, f"missing key: {key}"


def test_company(recorded_info):
    r = get_company(recorded_info)
    _assert_ok(r, ["name", "sector", "industry", "description", "ceo", "currency"])
    assert isinstance(r["name"], str) and r["name"]
    assert isinstance(r["sector"], str)


def test_quote(recorded_info):
    r = get_quote(recorded_info)
    _assert_ok(r, ["price", "change", "change_pct", "prev_close", "volume", "market_cap"])
    assert isinstance(r["price"], (int, float))
    assert isinstance(r["change_pct"], (int, float))


def test_financials(fake_stock, recorded_info):
    r = get_financials(fake_stock, recorded_info)
    _assert_ok(r, ["revenue", "margins", "eps_ttm", "pe_trailing", "net_income"])
    assert isinstance(r["revenue"], list) and r["revenue"], "revenue list should be non-empty"
    assert isinstance(r["margins"], list)


def test_technicals(fake_stock):
    r = get_technicals(fake_stock)
    _assert_ok(r, ["rsi", "chart_data", "sma20", "macd", "bb_upper", "support_levels"])
    assert isinstance(r["rsi"], float)
    assert isinstance(r["chart_data"], list) and r["chart_data"], "chart_data should be non-empty"
    # each chart bar carries the OHLC the frontend charts
    assert {"date", "open", "high", "low", "close"} <= set(r["chart_data"][0])


def test_options(fake_stock, recorded_info):
    r = get_options_flow(fake_stock, recorded_info)
    _assert_ok(r, ["per_expiry", "put_call_ratio", "unusual_contracts",
                   "overall_sentiment", "total_call_volume"])
    assert isinstance(r["per_expiry"], list) and r["per_expiry"], "per_expiry should be non-empty"
    assert isinstance(r["unusual_contracts"], list)
    assert isinstance(r["overall_sentiment"], str)


def test_earnings(fake_stock, recorded_info):
    r = get_earnings(fake_stock, recorded_info)
    _assert_ok(r, ["history", "beat_count", "miss_count", "next_earnings_date"])
    assert isinstance(r["history"], list)
    assert isinstance(r["beat_count"], int)
    assert isinstance(r["miss_count"], int)


def test_ratings(fake_stock, recorded_info):
    r = get_analyst_ratings(fake_stock, recorded_info)
    _assert_ok(r, ["consensus", "target_price_mean", "total_analysts", "recent_changes"])
    assert isinstance(r["consensus"], str) and r["consensus"]
    assert isinstance(r["total_analysts"], int)
    assert isinstance(r["recent_changes"], list)
