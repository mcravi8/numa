"""Macro layer: rates, labor, inflation, growth, market conditions, market-implied
Fed probabilities, and an events calendar. Data from FRED (free) and yfinance
(indices only), cached for one hour.
"""
# ============================================================
# === MACRO LAYER ===
# ============================================================
# A free macro-economic layer: rates, labor, inflation, growth, market
# conditions, market-implied Fed probabilities and an events calendar.
# All data from FRED (free, https://fred.stlouisfed.org) and yfinance
# (indices only). Cached for 1 hour to avoid hammering FRED on every load.

import math
import time
from datetime import datetime

import requests
import yfinance as yf
from fastapi import APIRouter

from app.config import FRED_KEY

router = APIRouter()

FRED_BASE = "https://api.stlouisfed.org/fred"

MACRO_CACHE = {"data": None, "timestamp": None}
MACRO_TTL = 3600  # 1 hour in seconds


def _macro_clean(obj):
    """Recursively convert NaN/Infinity floats to None so the payload survives
    Starlette's strict (allow_nan=False) JSON rendering. yfinance occasionally
    yields NaN (empty/partial frames), which would otherwise 500 the response."""
    if isinstance(obj, float):
        return None if (math.isnan(obj) or math.isinf(obj)) else obj
    if isinstance(obj, dict):
        return {k: _macro_clean(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_macro_clean(v) for v in obj]
    return obj


def fred_get(series_id: str, limit: int = 12) -> list:
    """Fetch last `limit` observations for a FRED series. Returns list of {date, value}."""
    try:
        r = requests.get(
            f"{FRED_BASE}/series/observations",
            params={
                "series_id": series_id,
                "api_key": FRED_KEY,
                "file_type": "json",
                "sort_order": "desc",
                "limit": limit,
            },
            timeout=10,
        )
        obs = r.json().get("observations", [])
        return [
            {"date": o["date"], "value": float(o["value"]) if o["value"] != "." else None}
            for o in obs
            if o["value"] != "."
        ][::-1]  # reverse to chronological order
    except Exception:
        return []


def fred_latest(series_id: str) -> dict:
    """Get the single most recent value for a series (plus prior value & change)."""
    obs = fred_get(series_id, limit=2)
    if not obs:
        return {"value": None, "date": None, "prev": None}
    latest = obs[-1]
    prev = obs[-2] if len(obs) >= 2 else None
    return {
        "value": latest["value"],
        "date": latest["date"],
        "prev": prev["value"] if prev else None,
        "change": round(latest["value"] - prev["value"], 3) if prev and latest["value"] and prev["value"] else None,
        "change_pct": round((latest["value"] - prev["value"]) / abs(prev["value"]) * 100, 2) if prev and latest["value"] and prev["value"] else None,
    }


def get_fed_probabilities() -> dict:
    """
    Compute market-implied FOMC probabilities from 30-Day Fed Funds futures.
    Ticker format: ZQ + month code + year (e.g. ZQN26 = July 2026)
    Month codes: F=Jan G=Feb H=Mar J=Apr K=May M=Jun N=Jul Q=Aug U=Sep V=Oct X=Nov Z=Dec
    Fed Funds futures price = 100 - implied average rate for that month.
    """
    try:
        # Current Fed Funds target (effective rate ~ midpoint of current range)
        fedfunds = fred_latest("FEDFUNDS")
        current_rate = fedfunds["value"]  # e.g. 3.625 (midpoint of 3.5-3.75%)

        # FOMC 2026 schedule: Jan 28-29, Mar 18-19, May 6-7, Jun 17-18,
        # Jul 29-30, Sep 16-17, Oct 28-29, Dec 9-10. Update quarterly.
        fomc_dates = [
            {"date": "2026-07-30", "label": "Jul 29-30"},
            {"date": "2026-09-17", "label": "Sep 16-17"},
            {"date": "2026-10-29", "label": "Oct 28-29"},
            {"date": "2026-12-10", "label": "Dec 9-10"},
        ]

        # Filter to upcoming meetings only
        today = datetime.now().strftime("%Y-%m-%d")
        upcoming = [f for f in fomc_dates if f["date"] > today][:3]

        if current_rate is None:
            return {
                "current_rate": None,
                "current_range": None,
                "meetings": [{"meeting": m["label"], "date": m["date"],
                              "implied_rate": None, "prob_cut_25bps": None,
                              "prob_hold": None, "futures_price": None} for m in upcoming],
            }

        # Month code map
        month_codes = {1: "F", 2: "G", 3: "H", 4: "J", 5: "K", 6: "M",
                       7: "N", 8: "Q", 9: "U", 10: "V", 11: "X", 12: "Z"}

        results = []
        for meeting in upcoming:
            meeting_dt = datetime.strptime(meeting["date"], "%Y-%m-%d")
            # Futures for the month OF the meeting
            month_code = month_codes[meeting_dt.month]
            year_short = str(meeting_dt.year)[-2:]
            ticker = f"ZQ{month_code}{year_short}.CBT"

            try:
                stock = yf.Ticker(ticker)
                price = stock.info.get("regularMarketPrice") or stock.fast_info.get("lastPrice")
                if not price:
                    hist = stock.history(period="1d")
                    price = float(hist["Close"].iloc[-1]) if not hist.empty else None

                if price:
                    implied_rate = round(100 - price, 4)
                    # Probability of a 25bps cut: if implied rate < current rate,
                    # the market is pricing a cut. Each 25bps cut moves the
                    # implied rate by ~0.25.
                    rate_diff = current_rate - implied_rate
                    prob_cut = round(min(max(rate_diff / 0.25 * 100, 0), 100), 1)
                    prob_hold = round(100 - prob_cut, 1)
                    results.append({
                        "meeting": meeting["label"],
                        "date": meeting["date"],
                        "implied_rate": implied_rate,
                        "prob_cut_25bps": prob_cut,
                        "prob_hold": prob_hold,
                        "futures_price": round(price, 4),
                    })
                else:
                    raise ValueError("no price")
            except Exception:
                results.append({
                    "meeting": meeting["label"],
                    "date": meeting["date"],
                    "implied_rate": None,
                    "prob_cut_25bps": None,
                    "prob_hold": None,
                    "futures_price": None,
                })

        return {
            "current_rate": current_rate,
            "current_range": f"{round(current_rate - 0.125, 2)}%–{round(current_rate + 0.125, 2)}%",
            "meetings": results,
        }
    except Exception as e:
        return {"error": str(e)}


@router.get("/macro")
def get_macro() -> dict:
    """
    Pull all macro indicators. Cached for 1-hour TTL (20+ FRED requests).
    All data from FRED (free) and yfinance (indices only).
    """
    now = time.time()
    if MACRO_CACHE["data"] and MACRO_CACHE["timestamp"] and (now - MACRO_CACHE["timestamp"]) < MACRO_TTL:
        return MACRO_CACHE["data"]

    result = {
        "timestamp": datetime.utcnow().isoformat(),
        "rates": None,
        "labor": None,
        "inflation": None,
        "growth": None,
        "market_conditions": None,
        "fed_probabilities": None,
        "upcoming_events": None,
        "error": None,
    }

    try:
        # ── RATES ──────────────────────────────────────────────────
        fedfunds = fred_latest("FEDFUNDS")        # Fed Funds effective rate
        t10y = fred_latest("DGS10")               # 10Y Treasury yield
        t2y = fred_latest("DGS2")                 # 2Y Treasury yield
        t30y = fred_latest("DGS30")               # 30Y Treasury yield
        mortgage30 = fred_latest("MORTGAGE30US")  # 30Y mortgage rate

        spread_10_2 = round(t10y["value"] - t2y["value"], 3) if t10y["value"] and t2y["value"] else None
        curve_signal = (
            "Steeply Inverted" if spread_10_2 and spread_10_2 < -0.5 else
            "Inverted" if spread_10_2 and spread_10_2 < 0 else
            "Flat" if spread_10_2 and spread_10_2 < 0.2 else
            "Steepening" if spread_10_2 and spread_10_2 < 0.6 else
            "Steep"
        ) if spread_10_2 is not None else None

        # Equity risk premium: S&P 500 earnings yield (1/PE) minus 10Y yield.
        # Use SPY as proxy.
        try:
            spy = yf.Ticker("SPY")
            spy_pe = spy.info.get("trailingPE")
            earnings_yield = round(1 / spy_pe * 100, 2) if spy_pe else None
            erp = round(earnings_yield - t10y["value"], 2) if earnings_yield and t10y["value"] else None
        except Exception:
            earnings_yield = None
            erp = None

        result["rates"] = {
            "fed_funds": fedfunds,
            "treasury_10y": t10y,
            "treasury_2y": t2y,
            "treasury_30y": t30y,
            "mortgage_30y": mortgage30,
            "spread_10y_2y": spread_10_2,
            "yield_curve_signal": curve_signal,
            "sp500_earnings_yield": earnings_yield,
            "equity_risk_premium": erp,
            # History for charts
            "t10y_history": fred_get("DGS10", limit=252),    # daily, ~1 year
            "t2y_history": fred_get("DGS2", limit=252),
            "fedfunds_history": fred_get("FEDFUNDS", limit=24),  # monthly, 2 years
        }

        # ── LABOR ──────────────────────────────────────────────────
        unrate = fred_latest("UNRATE")    # U-3 unemployment rate (monthly)
        u6rate = fred_latest("U6RATE")    # U-6 underemployment rate (monthly)
        payems = fred_latest("PAYEMS")    # Total nonfarm payrolls (monthly, thousands)
        icsa = fred_latest("ICSA")        # Initial jobless claims (weekly)
        jolts = fred_latest("JTSJOL")     # JOLTS job openings (monthly, thousands)

        # NFP month-over-month change (PAYEMS is in thousands)
        payems_hist = fred_get("PAYEMS", limit=3)
        nfp_change = None
        if len(payems_hist) >= 2:
            nfp_change = int((payems_hist[-1]["value"] - payems_hist[-2]["value"]) * 1000)

        result["labor"] = {
            "unemployment_rate": unrate,
            "u6_rate": u6rate,
            "nonfarm_payrolls": payems,
            "nfp_change_mom": nfp_change,
            "initial_claims": icsa,
            "jolts_openings": jolts,
            "unrate_history": fred_get("UNRATE", limit=24),
        }

        # ── INFLATION ──────────────────────────────────────────────
        cpi = fred_latest("CPIAUCSL")        # CPI all items (index level)
        cpi_core = fred_latest("CPILFESL")   # Core CPI (ex food & energy)
        pce = fred_latest("PCEPI")           # PCE price index (Fed's preferred)
        pce_core = fred_latest("PCEPILFE")   # Core PCE
        ppi = fred_latest("PPIACO")          # PPI all commodities

        def yoy(series_id):
            # Request extra months so a single missing print (FRED data gaps,
            # e.g. a shutdown month) doesn't break the calc; match the value
            # ~12 months prior by calendar date rather than by list index.
            hist = fred_get(series_id, limit=16)
            if len(hist) < 2:
                return None
            latest = hist[-1]
            ld = datetime.strptime(latest["date"], "%Y-%m-%d")
            prior = next(
                (o for o in hist
                 if datetime.strptime(o["date"], "%Y-%m-%d").year == ld.year - 1
                 and datetime.strptime(o["date"], "%Y-%m-%d").month == ld.month),
                None,
            )
            if prior is None and len(hist) >= 13:
                prior = hist[-13]  # fallback: 12 present-months back
            if prior and prior["value"] and latest["value"]:
                return round((latest["value"] - prior["value"]) / prior["value"] * 100, 2)
            return None

        cpi_yoy = yoy("CPIAUCSL")
        cpi_core_yoy = yoy("CPILFESL")
        pce_yoy = yoy("PCEPI")
        pce_core_yoy = yoy("PCEPILFE")

        result["inflation"] = {
            "cpi": cpi,
            "cpi_yoy": cpi_yoy,
            "cpi_core": cpi_core,
            "cpi_core_yoy": cpi_core_yoy,
            "pce": pce,
            "pce_yoy": pce_yoy,
            "pce_core": pce_core,
            "pce_core_yoy": pce_core_yoy,
            "ppi": ppi,
            "cpi_history": fred_get("CPIAUCSL", limit=24),
        }

        # ── GROWTH ──────────────────────────────────────────────────
        gdp = fred_latest("GDP")             # Nominal GDP (quarterly, billions)
        gdp_real = fred_latest("GDPC1")      # Real GDP (quarterly)
        retail = fred_latest("RSXFS")        # Retail sales ex food services (monthly)
        consumer_sent = fred_latest("UMCSENT")  # U Michigan consumer sentiment

        # Real GDP YoY (4 quarters back)
        gdp_hist = fred_get("GDPC1", limit=5)
        gdp_yoy = None
        if len(gdp_hist) >= 5 and gdp_hist[-5]["value"]:
            gdp_yoy = round((gdp_hist[-1]["value"] - gdp_hist[-5]["value"]) / gdp_hist[-5]["value"] * 100, 2)

        result["growth"] = {
            "gdp": gdp,
            "gdp_real": gdp_real,
            "gdp_yoy": gdp_yoy,
            "retail_sales": retail,
            "consumer_sentiment": consumer_sent,
            "gdp_history": fred_get("GDPC1", limit=12),
        }

        # ── MARKET CONDITIONS ──────────────────────────────────────
        try:
            # Helper: most recent NON-NaN close (yfinance can append a NaN
            # current-day row before the print fills, which skews everything).
            def _closes(tk, period):
                try:
                    h = yf.Ticker(tk).history(period=period)
                    c = h["Close"].dropna() if not h.empty else h.get("Close")
                    return c if c is not None and len(c) else None
                except Exception:
                    return None

            vix = yf.Ticker("^VIX")
            vix_closes = _closes("^VIX", "1mo")
            vix_price = vix.info.get("regularMarketPrice")
            if not vix_price and vix_closes is not None:
                vix_price = float(vix_closes.iloc[-1])
            vix_20d_avg = float(vix_closes.mean()) if vix_closes is not None else None

            dxy = yf.Ticker("DX-Y.NYB")
            dxy_price = dxy.info.get("regularMarketPrice")
            dxy_closes = _closes("DX-Y.NYB", "1mo")
            if not dxy_price and dxy_closes is not None:
                dxy_price = float(dxy_closes.iloc[-1])
            dxy_change_1m = None
            if dxy_closes is not None and len(dxy_closes) >= 2 and dxy_closes.iloc[0]:
                dxy_change_1m = round((float(dxy_closes.iloc[-1]) - float(dxy_closes.iloc[0])) / float(dxy_closes.iloc[0]) * 100, 2)

            spy_closes = _closes("SPY", "1y")
            spy_price = float(spy_closes.iloc[-1]) if spy_closes is not None else None
            spy_sma200 = float(spy_closes.tail(200).mean()) if spy_closes is not None and len(spy_closes) >= 200 else None
            spy_vs_200ma = round((spy_price - spy_sma200) / spy_sma200 * 100, 1) if spy_price and spy_sma200 else None
            market_regime = ("Bull" if spy_vs_200ma > 0 else "Bear") if spy_vs_200ma is not None else None

            tlt = yf.Ticker("TLT")
            tlt_price = tlt.info.get("regularMarketPrice")
            tlt_closes = _closes("TLT", "1mo")
            if not tlt_price and tlt_closes is not None:
                tlt_price = float(tlt_closes.iloc[-1])
            tlt_change_1m = None
            if tlt_closes is not None and len(tlt_closes) >= 2 and tlt_closes.iloc[0]:
                tlt_change_1m = round((float(tlt_closes.iloc[-1]) - float(tlt_closes.iloc[0])) / float(tlt_closes.iloc[0]) * 100, 2)

            # VIX history for sparkline
            vix_hist_vals = [
                {"date": idx.strftime("%Y-%m-%d"), "value": round(float(v), 2)}
                for idx, v in (vix_closes.items() if vix_closes is not None else [])
            ]

            result["market_conditions"] = {
                "vix": round(vix_price, 2) if vix_price else None,
                "vix_20d_avg": round(vix_20d_avg, 2) if vix_20d_avg else None,
                "vix_signal": ("Elevated" if vix_price > 25 else ("Low" if vix_price < 15 else "Normal")) if vix_price else None,
                "dxy": round(dxy_price, 2) if dxy_price else None,
                "dxy_change_1m": dxy_change_1m,
                "spy_price": round(spy_price, 2) if spy_price else None,
                "spy_vs_200ma_pct": spy_vs_200ma,
                "market_regime": market_regime,
                "tlt_price": round(tlt_price, 2) if tlt_price else None,
                "tlt_change_1m": tlt_change_1m,
                "vix_history": vix_hist_vals[-30:],  # last 30 days
            }
        except Exception as e:
            result["market_conditions"] = {"error": str(e)}

        # ── FED PROBABILITIES ──────────────────────────────────────
        result["fed_probabilities"] = get_fed_probabilities()

        # ── UPCOMING EVENTS CALENDAR ───────────────────────────────
        # Hardcoded 2026 calendar — update quarterly or load from a free
        # events API. Key economic releases with approximate dates.
        today_str = datetime.now().strftime("%Y-%m-%d")
        all_events = [
            # FOMC
            {"date": "2026-07-30", "event": "FOMC Decision", "type": "fomc", "importance": "critical"},
            {"date": "2026-09-17", "event": "FOMC Decision", "type": "fomc", "importance": "critical"},
            {"date": "2026-10-29", "event": "FOMC Decision", "type": "fomc", "importance": "critical"},
            {"date": "2026-12-10", "event": "FOMC Decision", "type": "fomc", "importance": "critical"},
            # CPI (~2 weeks after month end)
            {"date": "2026-07-15", "event": "CPI (Jun)", "type": "inflation", "importance": "high"},
            {"date": "2026-08-12", "event": "CPI (Jul)", "type": "inflation", "importance": "high"},
            {"date": "2026-09-11", "event": "CPI (Aug)", "type": "inflation", "importance": "high"},
            {"date": "2026-10-14", "event": "CPI (Sep)", "type": "inflation", "importance": "high"},
            {"date": "2026-11-12", "event": "CPI (Oct)", "type": "inflation", "importance": "high"},
            # NFP (first Friday of each month)
            {"date": "2026-07-02", "event": "NFP (Jun)", "type": "labor", "importance": "high"},
            {"date": "2026-08-07", "event": "NFP (Jul)", "type": "labor", "importance": "high"},
            {"date": "2026-09-04", "event": "NFP (Aug)", "type": "labor", "importance": "high"},
            {"date": "2026-10-02", "event": "NFP (Sep)", "type": "labor", "importance": "high"},
            {"date": "2026-11-06", "event": "NFP (Oct)", "type": "labor", "importance": "high"},
            # GDP (quarterly, ~last week of month after quarter end)
            {"date": "2026-07-30", "event": "GDP Q2 Advance", "type": "growth", "importance": "high"},
            {"date": "2026-10-29", "event": "GDP Q3 Advance", "type": "growth", "importance": "high"},
            # PCE (~last Friday of the month)
            {"date": "2026-07-31", "event": "PCE (Jun)", "type": "inflation", "importance": "high"},
            {"date": "2026-08-28", "event": "PCE (Jul)", "type": "inflation", "importance": "high"},
            {"date": "2026-09-25", "event": "PCE (Aug)", "type": "inflation", "importance": "high"},
        ]

        upcoming_events = sorted(
            [e for e in all_events if e["date"] >= today_str],
            key=lambda x: x["date"]
        )[:15]

        # Add days_away
        for e in upcoming_events:
            e["days_away"] = (datetime.strptime(e["date"], "%Y-%m-%d") - datetime.now()).days

        result["upcoming_events"] = upcoming_events

    except Exception as e:
        result["error"] = str(e)

    result = _macro_clean(result)
    MACRO_CACHE["data"] = result
    MACRO_CACHE["timestamp"] = now
    return result
