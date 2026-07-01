# ============================================================
# === MODULE 11: CONGRESSIONAL TRADES (Quiver Quantitative) ===
# ============================================================

import requests
from datetime import datetime, timedelta

from app.config import (
    QUIVER_API_KEY,
    QUIVER_BASE,
    QUIVER_HEADERS,
)


# Real STOCK Act disclosures. Members of the US Congress must publicly file
# their securities trades within 45 days, so the gap between when a trade was
# made and when it was disclosed is itself a signal — a long lag means the
# public learned late. That gap is surfaced per trade (disclosure_lag_days) and
# in the summary (avg/max lag + a notable_flag for the slowest disclosure).
#
# This is a FETCHER (see docs/module-pattern.md, "Rules for a new module"): it takes
# the bare ticker, calls Quiver itself with an explicit 10s timeout, and reads
# its auth from the module-level QUIVER_HEADERS constant near the top of the
# file. A clean run that simply finds no disclosures returns an empty trades
# list with a human-readable note — that is a success, not an error; the
# {"error": ...} bag is reserved for real failures (missing key, API down).
#
# Output keys mirror the shape the frontend already renders for this slot
# (politician / type / party / chamber / amount_range / disclosure_date, and a
# summary with total_purchases_90d / total_sales_90d / net_sentiment /
# notable_flag), so the Congress panel shows real data unchanged. Quiver's
# congress feed carries no committee field, so "committee" is always None here.

def get_congressional_trades(ticker: str) -> dict:
    try:
        if not QUIVER_API_KEY:
            return {"error": "QUIVER_API_KEY not configured"}

        ticker = ticker.upper().strip()
        r = requests.get(
            f"{QUIVER_BASE}/historical/congresstrading/{ticker}",
            headers=QUIVER_HEADERS,
            timeout=10,
        )

        # Finding no disclosures is a normal empty result, not a failure.
        empty = {
            "trades": [],
            "trades_count": 0,
            "summary": {
                "total_purchases_90d": 0,
                "total_sales_90d": 0,
                "net_sentiment": "Neutral",
                "notable_flag": None,
                "avg_disclosure_lag_days": None,
                "max_disclosure_lag_days": None,
            },
            "note": "No disclosed congressional trades for this ticker in the lookback window.",
            "source": "Quiver Quantitative",
        }
        if r.status_code == 404:
            return empty
        if r.status_code != 200:
            return {"error": f"Quiver API returned HTTP {r.status_code}"}

        rows = r.json() or []
        if not isinstance(rows, list) or not rows:
            return empty

        def _chamber(v):
            v = (v or "").strip()
            low = v.lower()
            if low.startswith("rep") or low == "house":
                return "House"
            if low.startswith("sen"):
                return "Senate"
            return v or None

        # Normalize Quiver's vocabulary to the canonical values the rest of this
        # codebase (and the frontend) already speaks: "Purchase"/"Sale" and
        # "D"/"R"/"I". Always non-null so the UI can never crash on a blank cell,
        # and so the 90-day tally below agrees with the table's buy/sell colors.
        def _side(v):
            v = (v or "").strip()
            low = v.lower()
            if low.startswith("purchase") or low in ("buy", "bought"):
                return "Purchase"
            if low.startswith("sale") or low.startswith("sell") or low.startswith("sold"):
                return "Sale"
            return v or "N/A"  # e.g. "Exchange" — rare, neither buy nor sell

        def _party(v):
            v = (v or "").strip()
            low = v.lower()
            if low.startswith("d"):
                return "D"
            if low.startswith("r"):
                return "R"
            if low.startswith("i"):
                return "I"
            return v or "N/A"

        def _lag(tx, disc):
            try:
                d0 = datetime.strptime(tx[:10], "%Y-%m-%d")
                d1 = datetime.strptime(disc[:10], "%Y-%m-%d")
                return (d1 - d0).days
            except Exception:
                return None

        trades = []
        for row in rows:
            tx_date = (row.get("TransactionDate") or "")[:10]
            disc_date = (row.get("ReportDate") or "")[:10]
            trades.append({
                "politician": row.get("Representative") or "N/A",
                "chamber": _chamber(row.get("House")),
                "party": _party(row.get("Party")),
                "committee": None,  # Quiver's congress feed has no committee field
                "type": _side(row.get("Transaction")),
                "amount_range": row.get("Range") or row.get("Amount") or None,
                "transaction_date": tx_date or None,
                "disclosure_date": disc_date or None,
                "disclosure_lag_days": _lag(tx_date, disc_date),
            })

        # Newest disclosures first; cap the table at the 30 most recent.
        trades.sort(key=lambda t: t.get("disclosure_date") or "", reverse=True)
        shown = trades[:30]

        # 90-day buy/sell tally (matches the panel's "(90d)" labels).
        d90 = (datetime.now() - timedelta(days=90)).strftime("%Y-%m-%d")
        recent = [t for t in trades if (t["transaction_date"] or "") >= d90]
        buys = sum(1 for t in recent if t["type"] == "Purchase")
        sells = sum(1 for t in recent if t["type"] == "Sale")
        net = "Bullish" if buys > sells else ("Bearish" if sells > buys else "Neutral")

        # The disclosure gap is the point of this module — flag the slowest one.
        lags = [t["disclosure_lag_days"] for t in shown if t["disclosure_lag_days"] is not None]
        slowest = (max(shown, key=lambda t: t["disclosure_lag_days"]
                       if t["disclosure_lag_days"] is not None else -1)
                   if lags else None)
        notable_flag = None
        if slowest and (slowest["disclosure_lag_days"] or 0) >= 30:
            notable_flag = (
                f'{slowest["politician"]} disclosed a '
                f'{(slowest["type"] or "trade").lower()} {slowest["disclosure_lag_days"]} '
                f'days after the fact — near the 45-day STOCK Act limit.'
            )

        return {
            "trades": shown,
            "trades_count": len(trades),
            "summary": {
                "total_purchases_90d": buys,
                "total_sales_90d": sells,
                "net_sentiment": net,
                "notable_flag": notable_flag,
                "avg_disclosure_lag_days": round(sum(lags) / len(lags), 1) if lags else None,
                "max_disclosure_lag_days": max(lags) if lags else None,
            },
            "source": "Quiver Quantitative",
        }
    except Exception as e:
        return {"error": str(e)}
