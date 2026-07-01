# ============================================================
# RESEARCH TERMINAL — main.py
# Personal 360° Stock Analysis Terminal
#
# SETUP:
# 1. pip install -r requirements.txt
# 2. cp .env.example .env  →  fill in your API keys
#    - FINNHUB_API_KEY:  free at finnhub.io
#    - ANTHROPIC_API_KEY: console.anthropic.com
#    - UNUSUAL_WHALES_API_KEY: unusualwhales.com/pricing (premium, ~$50/mo)
#    - POLYGON_API_KEY: polygon.io ($29/mo Starter)
#    - QUIVER_API_KEY: quiverquant.com (premium) — live congressional trades
# 3. uvicorn main:app --reload --port 8000
# 4. Open http://localhost:8000 in browser (served by FastAPI, not file://)
#
# ============================================================
# RUNNING AS PWA:
# 1. ./start.sh  (or: uvicorn main:app --reload --port 8000)
# 2. Open Chrome → http://localhost:8000
# 3. Click install icon in Chrome address bar (⊕ or ⋮ menu)
#    → "Install Research Terminal"
# 4. App appears in dock and /Applications
#
# TO AUTO-START ON LOGIN:
# System Settings → General → Login Items → + → select start.sh
# Or drag start.sh into Login Items
# ============================================================
#
# PREMIUM TIER ACTIVATION GUIDE
# ============================================================
# Current status: All premium functions return DEMO data.
# To activate live data per module:
#
# MODULE A — Options Flow (Unusual Whales):
#   Replace get_options_flow_premium_demo() call in get_options_flow()
#   with get_options_flow_premium_live() and add your API key to .env
#   Endpoint: GET https://api.unusualwhales.com/api/stock/{ticker}/flow-alerts
#   Headers:  {"Authorization": f"Bearer {os.getenv('UNUSUAL_WHALES_API_KEY')}"}
#
# MODULE B — Dark Pool (Unusual Whales, same key):
#   Endpoint: GET https://api.unusualwhales.com/api/stock/{ticker}/dark-pool
#
# MODULE C — GEX (Unusual Whales, same key):
#   Endpoint: GET https://api.unusualwhales.com/api/stock/{ticker}/greek-exposure
#
# MODULE D — Congressional (NOW LIVE via Quiver Quantitative, not Unusual Whales):
#   Implemented in get_congressional_trades(). Set QUIVER_API_KEY in .env.
#   Endpoint: GET https://api.quiverquant.com/beta/historical/congresstrading/{ticker}
#
# MODULE E — Real-time Quote (Polygon.io, $29/mo):
#   Endpoint: GET https://api.polygon.io/v2/last/trade/{ticker}?apiKey={key}
# ============================================================

import math
import time
import json
import requests
import numpy as np
import pandas as pd
import yfinance as yf
from datetime import datetime, timedelta
from typing import List, Any
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import anthropic

from app.config import (
    ANTHROPIC_CLIENT,
    BASE_DIR,
    FINNHUB_CLIENT,
    FRED_KEY,
    NOTES_FILE,
    QUIVER_API_KEY,
    QUIVER_BASE,
    QUIVER_HEADERS,
    SEC_HEADERS,
)
from app.utils import _json_safe, _ovr

app = FastAPI(title="Research Terminal")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# === FRONTEND + PWA STATIC SERVING ===
# ============================================================
# Serve the SPA and PWA assets over HTTP. PWA manifests and service
# workers require HTTP origins, not file://, so the frontend is now
# served from here instead of being opened directly.
# NOTE: explicit routes must be defined BEFORE the catch-all static
# mount at the END of this file (route order matters in FastAPI).

@app.get("/")
def serve_frontend():
    """Serve the main HTML file."""
    return FileResponse(BASE_DIR / "index.html")


@app.get("/manifest.json")
def serve_manifest():
    return FileResponse(
        BASE_DIR / "manifest.json",
        media_type="application/manifest+json",
    )


@app.get("/sw.js")
def serve_sw():
    return FileResponse(
        BASE_DIR / "sw.js",
        media_type="application/javascript",
    )


@app.get("/icon-192.png")
def serve_icon_192():
    return FileResponse(BASE_DIR / "icon-192.png")


@app.get("/icon-512.png")
def serve_icon_512():
    return FileResponse(BASE_DIR / "icon-512.png")


# ============================================================
# === NOTES PERSISTENCE ===
# ============================================================
# Notes are saved AI outputs. The frontend always pushes the COMPLETE
# notes array on every change; we just write it to disk verbatim.

@app.get("/notes")
def get_notes():
    """Load notes from disk. Returns empty list if file doesn't exist."""
    try:
        if NOTES_FILE.exists():
            return json.loads(NOTES_FILE.read_text(encoding="utf-8"))
        return []
    except Exception:
        return []


@app.post("/notes")
def save_notes(notes: List[Any]):
    """Persist the full notes array to disk. Frontend sends the complete array."""
    try:
        NOTES_FILE.write_text(
            json.dumps(notes, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ============================================================
# === HEALTH ===
# ============================================================

@app.get("/health")
def health():
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat()}


# ============================================================
# === MAIN ANALYZE ENDPOINT ===
# ============================================================

@app.get("/analyze/{ticker}")
def analyze(ticker: str, mode: str = "free"):
    ticker = ticker.upper().strip()
    result = {
        "ticker": ticker,
        "mode": mode,
        "timestamp": datetime.utcnow().isoformat(),
        "company": None,
        "quote": None,
        "financials": None,
        "technicals": None,
        "options_flow": None,
        "insider_activity": None,
        "news_sentiment": None,
        "peers": None,
        "earnings": None,
        "analyst_ratings": None,
        "dark_pool": None,
        "gamma_exposure": None,
        "congressional_trades": None,
        "error": None,
    }

    try:
        stock = yf.Ticker(ticker)
        info = stock.info
        if not info or not info.get("longName"):
            result["error"] = f"Ticker '{ticker}' not found or no data available."
            return result

        # Free modules
        result["company"] = get_company(info)
        result["quote"] = get_quote(info, mode)
        result["financials"] = get_financials(stock, info)
        result["technicals"] = get_technicals(stock)
        result["options_flow"] = get_options_flow(stock, info, mode)
        result["insider_activity"] = get_insider_activity(ticker)
        result["news_sentiment"] = get_news_sentiment(ticker)
        result["peers"] = get_peers(ticker, info)
        result["earnings"] = get_earnings(stock, info)
        result["analyst_ratings"] = get_analyst_ratings(stock, info)

        # Premium modules (demo data when mode=premium)
        if mode == "premium":
            current_price = info.get("currentPrice", 100.0)
            result["dark_pool"] = get_dark_pool_demo(ticker, current_price)
            result["gamma_exposure"] = get_gex_demo(ticker, current_price)
            result["congressional_trades"] = get_congressional_trades(ticker)

    except Exception as e:
        result["error"] = str(e)

    return _json_safe(result)


@app.get("/quote/{ticker}")
def live_quote(ticker: str):
    """Lightweight, real live quote for the price ticker.

    Uses fast_info (a cheap Yahoo endpoint) so the frontend can poll this every
    few seconds while the market is open. Returns the actual last trade price and
    its change vs. previous close — never simulated. Falls back to the full info
    dict only when fast_info is missing fields."""
    ticker = ticker.upper().strip()
    out = {"ticker": ticker, "price": None, "change": None, "change_pct": None,
           "prev_close": None, "market_state": None, "currency": None, "error": None}
    try:
        stock = yf.Ticker(ticker)
        price = prev = ms = cur = None
        try:
            fi = stock.fast_info
            price = fi.get("lastPrice")
            prev = fi.get("previousClose")
            cur = fi.get("currency")
        except Exception:
            pass
        # marketState isn't in fast_info; only pay for the full info call if we
        # still need a price (keeps the common polling path fast).
        if price is None or prev is None:
            info = stock.info
            if price is None:
                price = info.get("currentPrice") or info.get("regularMarketPrice")
            if prev is None:
                prev = info.get("previousClose")
            ms = info.get("marketState")
            cur = cur or info.get("currency")
        price = _ovr(price)
        prev = _ovr(prev)
        if price is not None and prev:
            out["change"] = _ovr(price - prev)
            out["change_pct"] = _ovr((price - prev) / prev * 100)
        out["price"] = price
        out["prev_close"] = prev
        out["market_state"] = ms
        out["currency"] = cur
    except Exception as e:
        out["error"] = str(e)
    return _json_safe(out)


_NAME_CACHE = {}


@app.get("/quotes")
def batch_quotes(symbols: str = "", names: str = ""):
    """Batch quotes for the favorites watchlist: price + change vs. previous close
    for many symbols at once, fetched in parallel via fast_info (cheap). Pass a
    `names` sublist to also resolve company names (one slow info call per unknown,
    cached) — the frontend only requests names it doesn't already carry."""
    from concurrent.futures import ThreadPoolExecutor

    def _parse(s):
        seen = []
        for x in (s or "").split(","):
            x = x.strip().upper()
            if x and x not in seen:
                seen.append(x)
        return seen

    syms = _parse(symbols)[:60]
    need_names = set(_parse(names))

    def one(sym):
        q = {"symbol": sym, "price": None, "change": None, "change_pct": None, "name": None}
        try:
            t = yf.Ticker(sym)
            try:
                fi = t.fast_info
                price = _ovr(fi.get("lastPrice"))
                prev = _ovr(fi.get("previousClose"))
                q["price"] = price
                if price is not None and prev:
                    q["change"] = _ovr(price - prev)
                    q["change_pct"] = _ovr((price - prev) / prev * 100)
            except Exception:
                pass
            if sym in need_names:
                if sym in _NAME_CACHE:
                    q["name"] = _NAME_CACHE[sym]
                else:
                    nm = None
                    try:
                        info = t.info
                        nm = info.get("shortName") or info.get("longName")
                    except Exception:
                        nm = None
                    _NAME_CACHE[sym] = nm
                    q["name"] = nm
        except Exception:
            pass
        return q

    out = {}
    if syms:
        with ThreadPoolExecutor(max_workers=min(12, len(syms))) as ex:
            for q in ex.map(one, syms):
                out[q["symbol"]] = q
    return _json_safe({"quotes": out})


# ============================================================
# === STREAMING ANALYZE ENDPOINT (Server-Sent Events) ===
# ============================================================
# Emits one event as each module STARTS fetching and another when it
# COMPLETES, so the frontend can show live per-module progress:
#   data: {"module": "options_flow", "status": "fetching"}
#   data: {"module": "options_flow", "status": "done", "data": {...}}
# Ends with a "complete" event followed by a [DONE] sentinel.

# Ordered (module_key, friendly_label) pairs streamed for every request.
# `label` groups several backend modules under one progress row on the UI.
STREAM_MODULES = [
    ("company", "Quote & Profile"),
    ("quote", "Quote & Profile"),
    ("financials", "Financials"),
    ("analyst_ratings", "Financials"),
    ("technicals", "Technicals"),
    ("options_flow", "Options Chain"),
    ("insider_activity", "Insider Filings"),
    ("news_sentiment", "News"),
    ("peers", "Peer Comparison"),
    ("earnings", "Earnings"),
]


@app.get("/analyze/stream/{ticker}")
def analyze_stream(ticker: str, mode: str = "free"):
    ticker = ticker.upper().strip()

    def sse(payload: dict) -> str:
        return f"data: {json.dumps(payload, default=str)}\n\n"

    def gen():
        yield sse({"status": "start", "ticker": ticker, "mode": mode,
                   "timestamp": datetime.utcnow().isoformat()})
        try:
            stock = yf.Ticker(ticker)
            info = stock.info
            if not info or not info.get("longName"):
                yield sse({"status": "error",
                           "error": f"Ticker '{ticker}' not found or no data available."})
                yield "data: [DONE]\n\n"
                return

            current_price = info.get("currentPrice") or info.get("regularMarketPrice") or 100.0

            def run(key):
                if key == "company":          return get_company(info)
                if key == "quote":            return get_quote(info, mode)
                if key == "financials":       return get_financials(stock, info)
                if key == "analyst_ratings":  return get_analyst_ratings(stock, info)
                if key == "technicals":       return get_technicals(stock)
                if key == "options_flow":     return get_options_flow(stock, info, mode)
                if key == "insider_activity": return get_insider_activity(ticker)
                if key == "news_sentiment":   return get_news_sentiment(ticker)
                if key == "peers":            return get_peers(ticker, info)
                if key == "earnings":         return get_earnings(stock, info)
                return None

            for key, label in STREAM_MODULES:
                yield sse({"module": key, "label": label, "status": "fetching"})
                try:
                    data = run(key)
                except Exception as e:
                    data = {"error": str(e)}
                yield sse({"module": key, "label": label, "status": "done", "data": data})

            if mode == "premium":
                premium = [
                    ("dark_pool", "Dark Pool", lambda: get_dark_pool_demo(ticker, current_price)),
                    ("gamma_exposure", "Gamma Exposure", lambda: get_gex_demo(ticker, current_price)),
                    ("congressional_trades", "Congress", lambda: get_congressional_trades(ticker)),
                ]
                for key, label, fn in premium:
                    yield sse({"module": key, "label": label, "status": "fetching"})
                    try:
                        data = fn()
                    except Exception as e:
                        data = {"error": str(e)}
                    yield sse({"module": key, "label": label, "status": "done", "data": data})

            yield sse({"status": "complete", "timestamp": datetime.utcnow().isoformat()})
            yield "data: [DONE]\n\n"
        except Exception as e:
            yield sse({"status": "error", "error": str(e)})
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ============================================================
# === MODULE 1: COMPANY PROFILE ===
# ============================================================

def get_company(info: dict) -> dict:
    try:
        officers = info.get("companyOfficers", [])
        ceo = next(
            (o.get("name") for o in officers if "CEO" in o.get("title", "").upper()),
            officers[0].get("name") if officers else "N/A"
        )
        desc = info.get("longBusinessSummary", "")
        return {
            "name": info.get("longName", "N/A"),
            "sector": info.get("sector", "N/A"),
            "industry": info.get("industry", "N/A"),
            "description": desc[:600] + "..." if len(desc) > 600 else desc,
            "employees": info.get("fullTimeEmployees"),
            "headquarters": ", ".join(filter(None, [
                info.get("city"), info.get("state"), info.get("country")
            ])),
            "ceo": ceo,
            "website": info.get("website", ""),
            "exchange": info.get("exchange", ""),
            "currency": info.get("currency", "USD"),
        }
    except Exception as e:
        return {"error": str(e)}


# ============================================================
# === MODULE 2: QUOTE ===
# ============================================================

def get_quote(info: dict, mode: str = "free") -> dict:
    try:
        price = info.get("currentPrice") or info.get("regularMarketPrice", 0)
        prev = info.get("previousClose", price)
        chg = price - prev
        chg_pct = (chg / prev * 100) if prev else 0
        vol = info.get("volume", 0)
        avg_vol = info.get("averageVolume", 1)
        q = {
            "price": round(price, 2),
            "change": round(chg, 2),
            "change_pct": round(chg_pct, 2),
            "open": info.get("open"),
            "prev_close": prev,
            "day_high": info.get("dayHigh"),
            "day_low": info.get("dayLow"),
            "week_52_high": info.get("fiftyTwoWeekHigh"),
            "week_52_low": info.get("fiftyTwoWeekLow"),
            "volume": vol,
            "avg_volume": avg_vol,
            "volume_ratio": round(vol / avg_vol, 2) if avg_vol else None,
            "market_cap": info.get("marketCap"),
            "enterprise_value": info.get("enterpriseValue"),
            "beta": info.get("beta"),
            "shares_outstanding": info.get("sharesOutstanding"),
            "shares_short": info.get("sharesShort"),
            "short_ratio": info.get("shortRatio"),
            "short_pct_float": info.get("shortPercentOfFloat"),
            # Extended-hours session + movement (Yahoo *ChangePercent are in percent units)
            "market_state": info.get("marketState"),
            "pre_market_price": info.get("preMarketPrice"),
            "pre_market_change": info.get("preMarketChange"),
            "pre_market_change_pct": info.get("preMarketChangePercent"),
            "post_market_price": info.get("postMarketPrice"),
            "post_market_change": info.get("postMarketChange"),
            "post_market_change_pct": info.get("postMarketChangePercent"),
        }
        if mode == "premium":
            q.update({
                "demo": True,
                "source": "Polygon.io (demo)",
                "bid": round(price - 0.02, 2),
                "ask": round(price + 0.02, 2),
                "spread": 0.04,
                "spread_pct": round(0.04 / price * 100, 4),
                "vwap_today": round(price * 0.997, 2),
                "trades_per_minute": 412,
                "websocket_available": True,
            })
        return q
    except Exception as e:
        return {"error": str(e)}


# ============================================================
# === MODULE 3: FINANCIALS ===
# ============================================================

def get_financials(stock, info: dict) -> dict:
    try:
        income = stock.income_stmt
        balance = stock.balance_sheet
        cashflow = stock.cashflow

        def safe_row(df, candidates):
            for c in candidates:
                if c in df.index:
                    return df.loc[c]
            return pd.Series(dtype=float)

        def to_list(series):
            return [
                {"period": str(col.year), "value": (None if pd.isna(v) else int(v))}
                for col, v in series.items()
            ][:3]

        def pct_change(series):
            vals = [v for v in series.values if not pd.isna(v)]
            result = []
            for i in range(len(vals) - 1):
                if vals[i + 1] and vals[i + 1] != 0:
                    result.append(round((vals[i] - vals[i + 1]) / abs(vals[i + 1]) * 100, 1))
                else:
                    result.append(None)
            return result

        rev = safe_row(income, ["Total Revenue", "Revenue"])
        gp = safe_row(income, ["Gross Profit"])
        op = safe_row(income, ["Operating Income", "EBIT"])
        ni = safe_row(income, ["Net Income", "Net Income Common Stockholders"])
        ebitda = safe_row(income, ["EBITDA", "Normalized EBITDA"])

        cash = safe_row(balance, ["Cash And Cash Equivalents", "Cash Cash Equivalents And Short Term Investments"])
        debt = safe_row(balance, ["Total Debt", "Long Term Debt"])
        assets = safe_row(balance, ["Total Assets"])
        equity = safe_row(balance, ["Stockholders Equity", "Common Stock Equity"])

        rev_vals = rev.dropna()
        gp_vals = gp.dropna()

        margins = []
        for col in rev.index[:3]:
            r = rev.get(col)
            g = gp.get(col)
            o = op.get(col)
            n = ni.get(col)
            if r and r != 0:
                margins.append({
                    "period": str(col.year),
                    "gross_margin": round(g / r * 100, 1) if g and not pd.isna(g) else None,
                    "operating_margin": round(o / r * 100, 1) if o and not pd.isna(o) else None,
                    "net_margin": round(n / r * 100, 1) if n and not pd.isna(n) else None,
                })

        total_debt_val = debt.iloc[0] if not debt.empty and not pd.isna(debt.iloc[0]) else 0
        cash_val = cash.iloc[0] if not cash.empty and not pd.isna(cash.iloc[0]) else 0
        equity_val = equity.iloc[0] if not equity.empty and not pd.isna(equity.iloc[0]) else 1

        return {
            "revenue": to_list(rev),
            "gross_profit": to_list(gp),
            "operating_income": to_list(op),
            "net_income": to_list(ni),
            "ebitda": to_list(ebitda),
            "revenue_growth_yoy": pct_change(rev),
            "margins": margins,
            "eps_ttm": info.get("trailingEps"),
            "eps_forward": info.get("forwardEps"),
            "cash": int(cash_val) if cash_val else None,
            "total_debt": int(total_debt_val) if total_debt_val else None,
            "net_debt": int(total_debt_val - cash_val) if total_debt_val else None,
            "total_assets": int(assets.iloc[0]) if not assets.empty and not pd.isna(assets.iloc[0]) else None,
            "debt_to_equity": round(total_debt_val / equity_val, 2) if equity_val else None,
            "pe_trailing": info.get("trailingPE"),
            "pe_forward": info.get("forwardPE"),
            "ps_ratio": info.get("priceToSalesTrailing12Months"),
            "pb_ratio": info.get("priceToBook"),
            "ev_ebitda": info.get("enterpriseToEbitda"),
            "ev_revenue": info.get("enterpriseToRevenue"),
            "peg_ratio": info.get("pegRatio"),
        }
    except Exception as e:
        return {"error": str(e)}


# ============================================================
# === MODULE 4: TECHNICALS ===
# ============================================================

# --- Overlay geometry: Fibonacci, psychological levels, regression channel,
# --- candlestick + chart patterns, and historical P/E. All deterministic,
# --- computed from the SAME OHLCV the chart draws so the on-chart overlays and
# --- Numa's prose cite identical numbers. Every helper degrades to None/[] on
# --- bad data and never raises into get_technicals. _ovr() rounds for JSON and
# --- returns None on NaN/Inf (Starlette renders with allow_nan=False).

def _fib_label(r):
    s = f"{r * 100:.1f}"
    if s.endswith(".0"):
        s = s[:-2]
    return s + "%"


def compute_fibonacci(hist, lookback=120):
    """Fib retracement off the dominant swing in the last `lookback` bars.
    Direction = which extreme is more recent: 'up' (low→high, levels are pullback
    supports below the high) or 'down' (high→low, levels are resistances)."""
    try:
        h = hist.iloc[-lookback:]
        highs, lows = h["High"], h["Low"]
        hi, lo = float(highs.max()), float(lows.min())
        hi_idx, lo_idx = highs.idxmax(), lows.idxmin()
        if hi <= lo:
            return None
        rng = hi - lo
        if hi_idx >= lo_idx:
            direction = "up"
            price_of = lambda r: hi - r * rng
        else:
            direction = "down"
            price_of = lambda r: lo + r * rng
        ratios = [0.0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0]
        return {
            "swing_high": _ovr(hi), "swing_low": _ovr(lo),
            "high_date": hi_idx.strftime("%Y-%m-%d"),
            "low_date": lo_idx.strftime("%Y-%m-%d"),
            "direction": direction, "lookback_days": int(len(h)),
            "levels": [{"ratio": r, "label": _fib_label(r), "price": _ovr(price_of(r))}
                       for r in ratios],
        }
    except Exception:
        return None


def compute_psych_levels(price, span=0.12):
    """Round-number levels within ±span of price. Picks the largest 'nice' step
    (mag, mag/2, mag/4, mag/5, mag/10, mag/20) that yields 3–7 levels."""
    try:
        price = float(price)
        if price <= 0:
            return []
        mag = 10 ** math.floor(math.log10(price))
        lo, hi = price * (1 - span), price * (1 + span)
        best = []
        for step in [mag, mag / 2, mag / 4, mag / 5, mag / 10, mag / 20]:
            if step <= 0:
                continue
            lv, v = [], math.floor(lo / step) * step
            while v <= hi + 1e-9:
                if v > 0 and abs(v - price) / price <= span + 1e-9:
                    lv.append(round(v, 2))
                v += step
            if 3 <= len(lv) <= 7:
                return lv
            if len(lv) > len(best) and len(lv) <= 9:
                best = lv
        return best[:8]
    except Exception:
        return []


def compute_regression_channel(hist, lookback=120, k=2.0):
    """Linear-regression channel: least-squares line through close ± k·σ of the
    residuals. Deterministic 'where price is moving' band. Returns the three
    lines as start/end endpoints (the chart draws each as a 2-point segment)."""
    try:
        h = hist.iloc[-lookback:]
        closes = h["Close"].astype(float).values
        n = len(closes)
        if n < 20:
            return None
        x = np.arange(n)
        slope, intercept = np.polyfit(x, closes, 1)
        fit = slope * x + intercept
        sd = float(np.std(closes - fit))
        mid_s, mid_e = float(fit[0]), float(fit[-1])
        last = float(closes[-1])
        band = 2 * k * sd
        pos = (last - (mid_e - k * sd)) / band if band else 0.5
        position = "upper third" if pos > 0.66 else ("lower third" if pos < 0.34 else "mid channel")
        slope_pct = (slope * 252) / fit[0] * 100 if fit[0] else None
        return {
            "lookback_days": int(n),
            "start_date": h.index[0].strftime("%Y-%m-%d"),
            "end_date": h.index[-1].strftime("%Y-%m-%d"),
            "mid_start": _ovr(mid_s), "mid_end": _ovr(mid_e),
            "upper_start": _ovr(mid_s + k * sd), "upper_end": _ovr(mid_e + k * sd),
            "lower_start": _ovr(mid_s - k * sd), "lower_end": _ovr(mid_e - k * sd),
            "k": k, "std": _ovr(sd),
            "trend": "rising" if slope > 0 else ("falling" if slope < 0 else "flat"),
            "slope_pct_annual": round(float(slope_pct), 1) if slope_pct is not None and not math.isnan(slope_pct) else None,
            "position": position,
        }
    except Exception:
        return None


def compute_candle_patterns(hist, window=60):
    """Deterministic single/two-candle reversal patterns over the last `window`
    bars. Reliable to DETECT (simple OHLC geometry); modest predictive value, so
    framed as 'what just printed'. Returns the most recent ~12 to limit markers."""
    try:
        h = hist.iloc[-window:]
        o = h["Open"].astype(float).values
        hi = h["High"].astype(float).values
        lo = h["Low"].astype(float).values
        c = h["Close"].astype(float).values
        dates = [d.strftime("%Y-%m-%d") for d in h.index]
        out = []
        for i in range(len(c)):
            rng = hi[i] - lo[i]
            if rng <= 0:
                continue
            body = abs(c[i] - o[i])
            upsh = hi[i] - max(o[i], c[i])
            dnsh = min(o[i], c[i]) - lo[i]
            up = c[i] >= o[i]
            prior = c[max(0, i - 5):i]
            downtrend = len(prior) >= 3 and c[i - 1] < prior.mean()
            uptrend = len(prior) >= 3 and c[i - 1] > prior.mean()
            pat = direction = None
            if body <= 0.1 * rng:
                pat, direction = "Doji", "neutral"
            elif dnsh >= 2 * body and upsh <= body:
                pat, direction = ("Hammer", "bullish") if downtrend else ("Hanging Man", "bearish")
            elif upsh >= 2 * body and dnsh <= body:
                pat, direction = ("Shooting Star", "bearish") if uptrend else ("Inverted Hammer", "bullish")
            if i > 0:
                pbody = abs(c[i - 1] - o[i - 1])
                prev_up = c[i - 1] >= o[i - 1]
                if up and not prev_up and c[i] >= o[i - 1] and o[i] <= c[i - 1] and body > pbody:
                    pat, direction = "Bullish Engulfing", "bullish"
                elif (not up) and prev_up and o[i] >= c[i - 1] and c[i] <= o[i - 1] and body > pbody:
                    pat, direction = "Bearish Engulfing", "bearish"
            if pat:
                out.append({"date": dates[i], "pattern": pat, "direction": direction})
        return out[-12:]
    except Exception:
        return []


def _find_pivots(values, order=5):
    highs, lows = [], []
    n = len(values)
    for i in range(order, n - order):
        seg = values[i - order:i + order + 1]
        if values[i] == seg.max():
            if not highs or i - highs[-1][0] > order:
                highs.append((i, float(values[i])))
        if values[i] == seg.min():
            if not lows or i - lows[-1][0] > order:
                lows.append((i, float(values[i])))
    return highs, lows


def compute_chart_patterns(hist, lookback=180):
    """Best-effort detection of named formations (double top/bottom, head &
    shoulders, cup & handle) via swing-pivot geometry. These are INHERENTLY
    noisy — returned as low-confidence CANDIDATES with a confidence score for
    Numa to validate/reject, never asserted as fact. Empty list when nothing fits."""
    try:
        h = hist.iloc[-lookback:]
        close = h["Close"].astype(float).values
        dates = [d.strftime("%Y-%m-%d") for d in h.index]
        n = len(close)
        if n < 40:
            return []
        order = max(3, n // 30)
        highs, lows = _find_pivots(close, order=order)
        cands = []

        if len(highs) >= 2:
            (i1, v1), (i2, v2) = highs[-2], highs[-1]
            mid = close[i1:i2]
            if len(mid):
                trough = float(mid.min())
                if abs(v1 - v2) / max(v1, v2) < 0.04 and (min(v1, v2) - trough) / min(v1, v2) > 0.03:
                    target = trough - (max(v1, v2) - trough)
                    cands.append({"pattern": "Double Top", "direction": "bearish",
                                  "confidence": round(1 - abs(v1 - v2) / max(v1, v2) / 0.08, 2),
                                  "neckline": _ovr(trough), "target": _ovr(target),
                                  "dates": [dates[i1], dates[i2]],
                                  "note": "Twin peaks ~%.2f/%.2f; a break below the %.2f neckline projects ~%.2f." % (v1, v2, trough, target)})
        if len(lows) >= 2:
            (i1, v1), (i2, v2) = lows[-2], lows[-1]
            mid = close[i1:i2]
            if len(mid):
                peak = float(mid.max())
                if abs(v1 - v2) / max(v1, v2) < 0.04 and (peak - max(v1, v2)) / max(v1, v2) > 0.03:
                    target = peak + (peak - min(v1, v2))
                    cands.append({"pattern": "Double Bottom", "direction": "bullish",
                                  "confidence": round(1 - abs(v1 - v2) / max(v1, v2) / 0.08, 2),
                                  "neckline": _ovr(peak), "target": _ovr(target),
                                  "dates": [dates[i1], dates[i2]],
                                  "note": "Twin troughs ~%.2f/%.2f; a break above the %.2f neckline projects ~%.2f." % (v1, v2, peak, target)})
        if len(highs) >= 3:
            (iL, vL), (iH, vH), (iR, vR) = highs[-3], highs[-2], highs[-1]
            if vH > vL and vH > vR and abs(vL - vR) / max(vL, vR) < 0.05:
                neck = (float(close[iL:iH].min()) + float(close[iH:iR].min())) / 2
                target = neck - (vH - neck)
                cands.append({"pattern": "Head & Shoulders", "direction": "bearish",
                              "confidence": round(0.7 - abs(vL - vR) / max(vL, vR) / 0.05 * 0.3, 2),
                              "neckline": _ovr(neck), "target": _ovr(target),
                              "dates": [dates[iL], dates[iH], dates[iR]],
                              "note": "Head %.2f between shoulders %.2f/%.2f; neckline %.2f, downside target ~%.2f." % (vH, vL, vR, neck, target)})
        if len(lows) >= 3:
            (iL, vL), (iH, vH), (iR, vR) = lows[-3], lows[-2], lows[-1]
            if vH < vL and vH < vR and abs(vL - vR) / max(vL, vR) < 0.05:
                neck = (float(close[iL:iH].max()) + float(close[iH:iR].max())) / 2
                target = neck + (neck - vH)
                cands.append({"pattern": "Inverse Head & Shoulders", "direction": "bullish",
                              "confidence": round(0.7 - abs(vL - vR) / max(vL, vR) / 0.05 * 0.3, 2),
                              "neckline": _ovr(neck), "target": _ovr(target),
                              "dates": [dates[iL], dates[iH], dates[iR]],
                              "note": "Inverse: head %.2f below shoulders %.2f/%.2f; neckline %.2f, upside target ~%.2f." % (vH, vL, vR, neck, target)})
        if len(highs) >= 2:
            (iL, vL), (iR, vR) = highs[-2], highs[-1]
            seg = close[iL:iR]
            if len(seg) > 10:
                bottom = float(seg.min())
                depth = max(vL, vR) - bottom
                handle = close[iR:]
                if abs(vL - vR) / max(vL, vR) < 0.06 and depth / max(vL, vR) > 0.10 and len(handle) >= 3:
                    hpull = (vR - float(handle.min())) / vR
                    if 0 < hpull < 0.5 * depth / vR + 0.02 and close[-1] < vR:
                        cands.append({"pattern": "Cup & Handle", "direction": "bullish", "confidence": 0.3,
                                      "neckline": _ovr(vR), "target": _ovr(vR + depth),
                                      "dates": [dates[iL], dates[iR]],
                                      "note": "Rounded base ~%.0f%% deep, rims %.2f/%.2f; a breakout above %.2f projects ~%.2f." % (depth / max(vL, vR) * 100, vL, vR, vR, vR + depth)})

        cands.sort(key=lambda c: -(c.get("confidence") or 0))
        return cands[:4]
    except Exception:
        return []


def compute_pe_history(stock, hist):
    """Historical trailing P/E = price ÷ TTM EPS, to judge whether the stock is
    cheap or expensive vs its OWN multi-year range (a far better 'expensive?'
    signal than a single current multiple). EPS from reported quarterly actuals
    rolled to TTM, falling back to annual diluted EPS. Approximate by nature
    (EPS revisions, sparse history) — tagged with `method`; None if unusable."""
    try:
        close = hist["Close"].astype(float)
        if close.empty:
            return None

        def _naive(ts):
            ts = pd.Timestamp(ts)
            return ts.tz_localize(None) if ts.tzinfo else ts

        eps_idx, eps_val, method = [], [], None

        # 1) Reported quarterly EPS → rolling 4-quarter TTM
        try:
            ed = stock.get_earnings_dates(limit=28)
            if ed is not None and not ed.empty:
                col = next((c for c in ed.columns if "Reported" in c and "EPS" in c), None)
                if col:
                    s = ed[col].dropna().sort_index()
                    s = s[[_naive(i) <= _naive(close.index[-1]) for i in s.index]]
                    if len(s) >= 4:
                        ttm = s.rolling(4).sum().dropna()
                        eps_idx = [_naive(i) for i in ttm.index]
                        eps_val = [float(v) for v in ttm.values]
                        method = "ttm_reported_eps"
        except Exception:
            pass

        # 2) Fallback: annual diluted/basic EPS
        if not eps_idx:
            try:
                fin = stock.income_stmt
                if fin is not None and not fin.empty:
                    row = next((r for r in ["Diluted EPS", "Basic EPS"] if r in fin.index), None)
                    if row:
                        s = fin.loc[row].dropna()
                        pairs = sorted(((_naive(i), float(v)) for i, v in s.items()), key=lambda p: p[0])
                        eps_idx = [p[0] for p in pairs]
                        eps_val = [p[1] for p in pairs]
                        method = "annual_eps"
            except Exception:
                pass

        if len(eps_idx) < 2:
            return None

        # Forward-fill the most recent known TTM EPS as-of each price date
        series, full_pe, cur, ei = [], [], None, 0
        for d, px in zip((_naive(i) for i in close.index), close.values):
            while ei < len(eps_idx) and eps_idx[ei] <= d:
                cur = eps_val[ei]
                ei += 1
            if cur and cur > 0:
                pe = float(px) / cur
                if 0 < pe < 1000:
                    full_pe.append(pe)
                    series.append({"date": d.strftime("%Y-%m-%d"), "pe": round(pe, 2)})

        if len(full_pe) < 20:
            return None

        arr = np.array(full_pe)
        current = float(arr[-1])
        pctile = float((arr < current).mean() * 100)
        step = max(1, len(series) // 260)
        ds = series[::step]
        if ds[-1]["date"] != series[-1]["date"]:
            ds.append(series[-1])
        verdict = ("cheap vs its own history" if pctile < 25
                   else "expensive vs its own history" if pctile > 75
                   else "in its normal historical range")
        return {
            "series": ds, "current": round(current, 2),
            "min": round(float(arr.min()), 2), "max": round(float(arr.max()), 2),
            "median": round(float(np.median(arr)), 2),
            "p25": round(float(np.percentile(arr, 25)), 2),
            "p75": round(float(np.percentile(arr, 75)), 2),
            "percentile": round(pctile, 1), "verdict": verdict,
            "method": method, "years": round(len(full_pe) / 252, 1),
        }
    except Exception:
        return None


def get_technicals(stock) -> dict:
    try:
        hist = stock.history(period="5y", interval="1d")
        if hist.empty:
            return {"error": "No price history"}

        close = hist["Close"]
        volume = hist["Volume"]

        # SMAs
        sma20 = close.rolling(20).mean()
        sma50 = close.rolling(50).mean()
        sma200 = close.rolling(200).mean()
        price = close.iloc[-1]

        # RSI
        delta = close.diff()
        gain = delta.clip(lower=0).rolling(14).mean()
        loss = (-delta.clip(upper=0)).rolling(14).mean()
        rs = gain / loss
        rsi = 100 - (100 / (1 + rs))
        rsi_val = round(float(rsi.iloc[-1]), 1)

        # MACD
        ema12 = close.ewm(span=12).mean()
        ema26 = close.ewm(span=26).mean()
        macd_line = ema12 - ema26
        signal_line = macd_line.ewm(span=9).mean()
        histogram = macd_line - signal_line
        macd_val = round(float(macd_line.iloc[-1]), 4)
        signal_val = round(float(signal_line.iloc[-1]), 4)
        hist_val = round(float(histogram.iloc[-1]), 4)

        # Bollinger Bands
        bb_mid = sma20
        bb_std = close.rolling(20).std()
        bb_upper = bb_mid + 2 * bb_std
        bb_lower = bb_mid - 2 * bb_std
        bb_width = round(float((bb_upper.iloc[-1] - bb_lower.iloc[-1]) / bb_mid.iloc[-1] * 100), 2)

        if price > bb_upper.iloc[-1]:
            bb_position = "Above upper band"
        elif price > bb_mid.iloc[-1] + (bb_upper.iloc[-1] - bb_mid.iloc[-1]) * 0.5:
            bb_position = "Near upper band"
        elif price < bb_lower.iloc[-1]:
            bb_position = "Below lower band"
        elif price < bb_mid.iloc[-1] - (bb_mid.iloc[-1] - bb_lower.iloc[-1]) * 0.5:
            bb_position = "Near lower band"
        else:
            bb_position = "Middle"

        # Volume analysis
        vol_20avg = float(volume.rolling(20).mean().iloc[-1])
        vol_5avg = float(volume.rolling(5).mean().iloc[-1])
        vol_current = float(volume.iloc[-1])

        # Support/Resistance (local minima/maxima over 90 days)
        recent = close.iloc[-90:]
        supports, resistances = [], []
        window = 10
        for i in range(window, len(recent) - window):
            segment = recent.iloc[i - window:i + window + 1]
            val = recent.iloc[i]
            if val == segment.min():
                supports.append(round(float(val), 2))
            if val == segment.max():
                resistances.append(round(float(val), 2))
        supports = sorted(set(supports))[-3:]
        resistances = sorted(set(resistances))[:3]

        # Price history for chart (last 252 days)
        # Return the full ~5y window so the chart can scroll/zoom out; SMAs are
        # computed over the whole series above, so they stay valid across it.
        CHART_BARS = 1300
        chart_data = []
        sma20_list = sma20.iloc[-CHART_BARS:].tolist()
        sma50_list = sma50.iloc[-CHART_BARS:].tolist()
        sma200_list = sma200.iloc[-CHART_BARS:].tolist()
        for i, (idx, row) in enumerate(hist.iloc[-CHART_BARS:].iterrows()):
            chart_data.append({
                "date": idx.strftime("%Y-%m-%d"),
                "open": round(float(row["Open"]), 2),
                "high": round(float(row["High"]), 2),
                "low": round(float(row["Low"]), 2),
                "close": round(float(row["Close"]), 2),
                "volume": int(row["Volume"]) if not pd.isna(row["Volume"]) else 0,
                "sma20": round(float(sma20_list[i]), 2) if not math.isnan(sma20_list[i]) else None,
                "sma50": round(float(sma50_list[i]), 2) if not math.isnan(sma50_list[i]) else None,
                "sma200": round(float(sma200_list[i]), 2) if not math.isnan(sma200_list[i]) else None,
            })

        sma20_val = float(sma20.iloc[-1])
        sma50_val = float(sma50.iloc[-1])
        sma200_val = float(sma200.iloc[-1]) if not math.isnan(float(sma200.iloc[-1])) else None

        return {
            "price": round(float(price), 2),
            "sma20": round(sma20_val, 2),
            "sma50": round(sma50_val, 2),
            "sma200": round(sma200_val, 2) if sma200_val else None,
            "price_vs_sma20": "above" if price > sma20_val else "below",
            "price_vs_sma50": "above" if price > sma50_val else "below",
            "price_vs_sma200": ("above" if sma200_val and price > sma200_val else "below") if sma200_val else None,
            "golden_cross": bool(sma50_val > sma200_val) if sma200_val else None,
            "rsi": rsi_val,
            "rsi_signal": "Overbought" if rsi_val > 70 else ("Oversold" if rsi_val < 30 else "Neutral"),
            "macd": macd_val,
            "macd_signal": signal_val,
            "macd_histogram": hist_val,
            "macd_trend": "Bullish" if macd_val > signal_val else "Bearish",
            "bb_upper": round(float(bb_upper.iloc[-1]), 2),
            "bb_middle": round(float(bb_mid.iloc[-1]), 2),
            "bb_lower": round(float(bb_lower.iloc[-1]), 2),
            "bb_position": bb_position,
            "bb_width": bb_width,
            "volume_current": int(vol_current) if not math.isnan(vol_current) else 0,
            "volume_20d_avg": int(vol_20avg) if not math.isnan(vol_20avg) else 0,
            "volume_ratio": round(vol_current / vol_20avg, 2) if (vol_20avg and not math.isnan(vol_20avg) and not math.isnan(vol_current)) else None,
            "volume_trend": "Increasing" if vol_5avg > vol_20avg else "Decreasing",
            "support_levels": supports,
            "resistance_levels": resistances,
            "chart_data": chart_data,
            # --- Overlay geometry + valuation (Phases 1–3) ---
            "fib": compute_fibonacci(hist),
            "psych_levels": compute_psych_levels(price),
            "regression_channel": compute_regression_channel(hist),
            "candle_patterns": compute_candle_patterns(hist),
            "chart_patterns": compute_chart_patterns(hist),
            "pe_history": compute_pe_history(stock, hist),
        }
    except Exception as e:
        return {"error": str(e)}


# ============================================================
# === MODULE 5: OPTIONS FLOW ===
# ============================================================

def get_options_flow(stock, info: dict, mode: str = "free") -> dict:
    try:
        current_price = info.get("currentPrice", 100)
        expiries = stock.options[:4]
        if not expiries:
            return {"error": "No options data"}

        all_unusual = []
        per_expiry = []
        total_call_vol = total_put_vol = total_call_oi = total_put_oi = 0

        for exp in expiries:
            try:
                chain = stock.option_chain(exp)
                calls = chain.calls.fillna(0)
                puts = chain.puts.fillna(0)

                cv = int(calls["volume"].sum())
                pv = int(puts["volume"].sum())
                coi = int(calls["openInterest"].sum())
                poi = int(puts["openInterest"].sum())
                total_call_vol += cv
                total_put_vol += pv
                total_call_oi += coi
                total_put_oi += poi

                per_expiry.append({
                    "expiry": exp,
                    "call_volume": cv,
                    "put_volume": pv,
                    "put_call_ratio": round(pv / cv, 2) if cv else None,
                    "call_oi": coi,
                    "put_oi": poi,
                    "pcr_oi": round(poi / coi, 2) if coi else None,
                })

                # Unusual detection
                for _, row in pd.concat([
                    calls.assign(type="call"),
                    puts.assign(type="put")
                ]).iterrows():
                    vol = row.get("volume", 0) or 0
                    oi = row.get("openInterest", 0) or 0
                    iv = row.get("impliedVolatility", 0) or 0
                    strike = row.get("strike", 0)
                    flags = []
                    if oi > 0 and vol / oi > 5 and vol > 500:
                        flags.append("Unusual Volume Spike")
                    if iv > 1.5:
                        flags.append("Extreme IV")
                    days_to_exp = (datetime.strptime(exp, "%Y-%m-%d") - datetime.now()).days
                    otm_pct = abs(strike - current_price) / current_price if current_price else 0
                    if vol > 1000 and otm_pct > 0.05 and days_to_exp < 45:
                        flags.append("OTM Near-Term Whale")
                    if flags:
                        last_price = row.get("lastPrice", 0) or 0
                        all_unusual.append({
                            "type": row["type"],
                            "strike": strike,
                            "expiry": exp,
                            "volume": int(vol),
                            "open_interest": int(oi),
                            "vol_oi_ratio": round(vol / oi, 1) if oi else None,
                            "implied_volatility": round(iv, 3),
                            "flags": flags,
                            "moneyness": "ITM" if (row["type"] == "call" and strike < current_price) or (row["type"] == "put" and strike > current_price) else "OTM",
                            "premium_per_contract": round(last_price, 2),
                            "estimated_notional": int(vol * last_price * 100),
                        })
            except Exception:
                continue

        # Max pain (nearest expiry)
        max_pain = None
        try:
            chain0 = stock.option_chain(expiries[0])
            strikes = sorted(set(chain0.calls["strike"].tolist() + chain0.puts["strike"].tolist()))
            losses = []
            for s in strikes:
                call_loss = sum(max(0, s - k) * oi * 100
                                for k, oi in zip(chain0.calls["strike"], chain0.calls["openInterest"].fillna(0)))
                put_loss = sum(max(0, k - s) * oi * 100
                               for k, oi in zip(chain0.puts["strike"], chain0.puts["openInterest"].fillna(0)))
                losses.append(call_loss + put_loss)
            if losses:
                max_pain = strikes[losses.index(min(losses))]
        except Exception:
            pass

        pcr = round(total_put_vol / total_call_vol, 2) if total_call_vol else None
        sentiment = "Very Bearish" if pcr and pcr > 2 else ("Bearish" if pcr and pcr > 1.2 else ("Very Bullish" if pcr and pcr < 0.5 else ("Bullish" if pcr and pcr < 0.8 else "Neutral")))

        all_unusual.sort(key=lambda x: x.get("estimated_notional", 0), reverse=True)

        result = {
            "per_expiry": per_expiry,
            "total_call_volume": total_call_vol,
            "total_put_volume": total_put_vol,
            "put_call_ratio": pcr,
            "put_call_ratio_oi": round(total_put_oi / total_call_oi, 2) if total_call_oi else None,
            "overall_sentiment": sentiment,
            "unusual_contracts": all_unusual[:20],
            "unusual_contracts_count": len(all_unusual),
            "biggest_bet": all_unusual[0] if all_unusual else None,
            "max_pain": round(max_pain, 2) if max_pain else None,
            "max_pain_distance_pct": round((max_pain - current_price) / current_price * 100, 1) if max_pain and current_price else None,
        }

        if mode == "premium":
            result["premium_flow"] = get_options_flow_premium_demo()

        return result
    except Exception as e:
        return {"error": str(e)}


def get_options_flow_premium_demo() -> dict:
    return {
        "demo": True,
        "source": "Unusual Whales (demo)",
        "bullish_premium_today": 47_320_000,
        "bearish_premium_today": 12_840_000,
        "net_flow": 34_480_000,
        "flow_sentiment": "Strong Bullish",
        "5d_trend": [
            {"date": "2026-06-12", "net": 8_200_000},
            {"date": "2026-06-13", "net": 15_400_000},
            {"date": "2026-06-14", "net": -3_100_000},
            {"date": "2026-06-15", "net": 22_600_000},
            {"date": "2026-06-16", "net": 34_480_000},
        ],
        "flow_alerts": [
            {"time": "09:47:23", "type": "call", "strike": None, "expiry": "2026-07-18",
             "size": 2500, "premium": 1_875_000, "execution": "sweep",
             "sentiment": "Bullish", "flags": ["Sweep", "Large Premium", "OTM"]},
            {"time": "10:12:05", "type": "call", "strike": None, "expiry": "2026-08-15",
             "size": 5000, "premium": 3_250_000, "execution": "block",
             "sentiment": "Very Bullish", "flags": ["Block Trade", "Deep OTM", "Large Premium"]},
            {"time": "11:33:50", "type": "put", "strike": None, "expiry": "2026-07-18",
             "size": 1800, "premium": 720_000, "execution": "sweep",
             "sentiment": "Bearish", "flags": ["Sweep", "OTM", "Hedge Signal"]},
        ],
    }


# ============================================================
# === MODULE 6: INSIDER ACTIVITY ===
# ============================================================

def get_insider_activity(ticker: str) -> dict:
    try:
        # Get CIK
        cik_data = requests.get(
            "https://www.sec.gov/files/company_tickers.json",
            headers=SEC_HEADERS, timeout=10
        ).json()
        cik = None
        for v in cik_data.values():
            if v.get("ticker", "").upper() == ticker.upper():
                cik = v["cik_str"]
                break
        if not cik:
            return {"error": "CIK not found for ticker"}

        cik_padded = str(cik).zfill(10)
        sub = requests.get(
            f"https://data.sec.gov/submissions/CIK{cik_padded}.json",
            headers=SEC_HEADERS, timeout=10
        ).json()

        filings = sub.get("filings", {}).get("recent", {})
        forms = filings.get("form", [])
        dates = filings.get("filingDate", [])
        accessions = filings.get("accessionNumber", [])
        descriptions = filings.get("primaryDocument", [])

        transactions = []
        form4_indices = [i for i, f in enumerate(forms) if f == "4"][:30]

        tx_codes = {"P": "Purchase", "S": "Sale", "A": "Award/Grant", "F": "Tax Withholding",
                    "M": "Option Exercise", "G": "Gift", "D": "Disposition"}

        import re as _re
        for i in form4_indices:
            try:
                acc = accessions[i].replace("-", "")
                doc_raw = descriptions[i]
                # Strip the XSL stylesheet prefix to get raw XML path
                xml_filename = doc_raw.replace("xslF345X06/", "").replace("xslF345X05/", "").replace("xslF345X04/", "")
                xml_url = f"https://www.sec.gov/Archives/edgar/data/{cik}/{acc}/{xml_filename}"
                r = requests.get(xml_url, headers=SEC_HEADERS, timeout=8)
                if r.status_code != 200:
                    continue
                content = r.text

                name_match = _re.search(r"<rptOwnerName>(.*?)</rptOwnerName>", content, _re.DOTALL)
                title_match = _re.search(r"<officerTitle>(.*?)</officerTitle>", content, _re.DOTALL)
                code_match = _re.search(r"<transactionCode>(.*?)</transactionCode>", content, _re.DOTALL)
                shares_match = _re.search(r"<transactionShares>.*?<value>([\d.]+)</value>", content, _re.DOTALL)
                price_match = _re.search(r"<transactionPricePerShare>.*?<value>([\d.]+)</value>", content, _re.DOTALL)
                post_match = _re.search(r"<sharesOwnedFollowingTransaction>.*?<value>([\d.]+)</value>", content, _re.DOTALL)

                if not name_match or not code_match:
                    continue

                code = code_match.group(1).strip()
                shares = float(shares_match.group(1)) if shares_match else 0
                price = float(price_match.group(1)) if price_match else 0
                post = float(post_match.group(1)) if post_match else 0

                transactions.append({
                    "insider_name": name_match.group(1).strip(),
                    "title": title_match.group(1).strip() if title_match else "Director/Officer",
                    "transaction_date": dates[i],
                    "transaction_type": code,
                    "transaction_type_label": tx_codes.get(code, code),
                    "shares": int(shares),
                    "price_per_share": round(price, 2),
                    "total_value": int(shares * price),
                    "shares_owned_after": int(post),
                })
            except Exception:
                continue

        now = datetime.now()
        d30 = (now - timedelta(days=30)).strftime("%Y-%m-%d")
        d90 = (now - timedelta(days=90)).strftime("%Y-%m-%d")

        purchases_30d = [t for t in transactions if t["transaction_date"] >= d30 and t["transaction_type"] == "P"]
        sales_30d = [t for t in transactions if t["transaction_date"] >= d30 and t["transaction_type"] == "S"]
        purchases_90d = [t for t in transactions if t["transaction_date"] >= d90 and t["transaction_type"] == "P"]
        sales_90d = [t for t in transactions if t["transaction_date"] >= d90 and t["transaction_type"] == "S"]

        net_buying_30d = sum(t["total_value"] for t in purchases_30d) - sum(t["total_value"] for t in sales_30d)
        buy_count_90d = len(purchases_90d)
        sell_count_90d = len(sales_90d)

        ceo_activity = [t for t in transactions if "CEO" in t.get("title", "").upper() and t["transaction_date"] >= d90]

        biggest = max(transactions, key=lambda x: x["total_value"]) if transactions else None

        return {
            "transactions": transactions[:20],
            "net_buying_30d": net_buying_30d,
            "buy_count_90d": buy_count_90d,
            "sell_count_90d": sell_count_90d,
            "buy_sell_ratio_90d": round(buy_count_90d / sell_count_90d, 2) if sell_count_90d else None,
            "largest_single_transaction": biggest,
            "ceo_activity": ceo_activity[:3],
            "sentiment": "Bullish" if net_buying_30d > 0 else ("Bearish" if net_buying_30d < 0 else "Neutral"),
        }
    except Exception as e:
        return {"error": str(e)}


# ============================================================
# === MODULE 7: NEWS & SENTIMENT ===
# ============================================================

def _ai_news_sentiment(ticker: str, articles: list) -> dict:
    """Score headlines with Claude when no pre-computed sentiment is available.

    Finnhub's news_sentiment endpoint is premium-only, so on the free tier it
    silently fails and the sentiment panel is blank. Instead we send the
    headlines we already have to Claude and ask it to judge how each one moves
    the bull/bear thesis. Returns the same shape the UI's sentiment panel reads,
    plus a one-line bull_case / bear_case and a per-article label.

    Mutates each article's "sentiment" in place. Returns {} on any failure so
    the caller degrades gracefully (panel shows "—", exactly as before).
    """
    if not ANTHROPIC_CLIENT.api_key or not articles:
        return {}
    headlines = articles[:15]
    listing = "\n".join(
        f'{i}. {a.get("headline","")} ({a.get("source","")})'
        for i, a in enumerate(headlines)
    )
    schema = (
        '{"score":<number -1..1 overall, weighted by materiality & recency>,'
        '"label":"<Very Bullish|Bullish|Neutral|Bearish|Very Bearish>",'
        '"bull_case":"<=160 chars, what the bulls take from this news>",'
        '"bear_case":"<=160 chars, what the bears take from this news>",'
        '"articles":[{"i":<int>,"s":"<Bullish|Bearish|Neutral>"}]}'
    )
    system = (
        "You are an equity analyst classifying news sentiment for a single stock. "
        "Judge how each headline affects the bull/bear thesis for the given ticker, "
        "not whether it is generically positive. Reflect genuine disagreement: a "
        "mixed news flow should produce a near-zero score with both a real bull and "
        "bear case. Respond with ONLY minified JSON, no prose, no code fences."
    )
    user_msg = (
        f"Ticker: {ticker}\nHeadlines:\n{listing}\n\n"
        f"Return JSON exactly matching this schema:\n{schema}"
    )
    try:
        resp = ANTHROPIC_CLIENT.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=700,
            system=system,
            messages=[{"role": "user", "content": user_msg}],
        )
        raw = resp.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1].lstrip("json").strip()
        parsed = json.loads(raw)
    except Exception:
        return {}

    for item in parsed.get("articles", []):
        idx = item.get("i")
        if isinstance(idx, int) and 0 <= idx < len(headlines):
            headlines[idx]["sentiment"] = item.get("s")

    try:
        score = round(max(-1.0, min(1.0, float(parsed.get("score", 0.0)))), 3)
    except (TypeError, ValueError):
        score = 0.0
    label = parsed.get("label") or (
        "Very Bullish" if score > 0.3 else
        "Bullish" if score > 0.1 else
        "Very Bearish" if score < -0.3 else
        "Bearish" if score < -0.1 else "Neutral"
    )
    return {
        "score": score,
        "bullish_pct": round((score + 1) / 2, 3),
        "bearish_pct": round((1 - score) / 2, 3),
        "label": label,
        "bull_case": parsed.get("bull_case", ""),
        "bear_case": parsed.get("bear_case", ""),
        "source": "Claude",
    }


def get_news_sentiment(ticker: str) -> dict:
    try:
        articles = []
        sentiment_data = {}
        buzz = None

        if FINNHUB_CLIENT:
            from_date = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")
            to_date = datetime.now().strftime("%Y-%m-%d")
            try:
                news = FINNHUB_CLIENT.company_news(ticker, _from=from_date, to=to_date)
                for a in (news or [])[:15]:
                    articles.append({
                        "headline": a.get("headline", ""),
                        "source": a.get("source", ""),
                        "datetime": datetime.fromtimestamp(a.get("datetime", 0)).strftime("%Y-%m-%d %H:%M"),
                        "url": a.get("url", ""),
                        "sentiment": None,
                    })
            except Exception:
                pass
            try:
                s = FINNHUB_CLIENT.news_sentiment(ticker)
                buzz = s.get("buzz", {}).get("buzz")
                bullish = s.get("sentiment", {}).get("bullishPercent", 0.5)
                bearish = s.get("sentiment", {}).get("bearishPercent", 0.5)
                score = round(bullish - bearish, 3)
                sentiment_data = {
                    "score": score,
                    "bullish_pct": bullish,
                    "bearish_pct": bearish,
                    "label": (
                        "Very Bullish" if score > 0.3 else
                        "Bullish" if score > 0.1 else
                        "Bearish" if score < -0.1 else
                        "Very Bearish" if score < -0.3 else "Neutral"
                    ),
                }
            except Exception:
                pass

        # Fallback: yfinance news
        if not articles:
            stock = yf.Ticker(ticker)
            yf_news = stock.news or []
            for a in yf_news[:10]:
                ct = a.get("content", {})
                articles.append({
                    "headline": ct.get("title", a.get("title", "")),
                    "source": ct.get("provider", {}).get("displayName", ""),
                    "datetime": datetime.fromtimestamp(
                        a.get("providerPublishTime", 0) or
                        (ct.get("pubDate", "") and 0) or 0
                    ).strftime("%Y-%m-%d %H:%M") if a.get("providerPublishTime") else "",
                    "url": ct.get("canonicalUrl", {}).get("url", a.get("link", "")),
                    "sentiment": None,
                })

        # Finnhub's news_sentiment is premium-gated, so on the free tier
        # sentiment_data is empty here. Fall back to Claude scoring the
        # headlines we already have (free-tier friendly, and richer: it
        # produces per-article labels plus a bull/bear case).
        if not sentiment_data.get("score") and articles:
            ai = _ai_news_sentiment(ticker, articles)
            if ai:
                sentiment_data = ai

        one_week_ago = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
        articles_this_week = sum(1 for a in articles if a.get("datetime", "") >= one_week_ago)

        return {
            "articles": articles,
            "articles_count": len(articles),
            "articles_this_week": articles_this_week,
            "buzz_score": buzz,
            "sentiment": sentiment_data,
        }
    except Exception as e:
        return {"error": str(e)}


# ============================================================
# === MODULE 8: PEERS ===
# ============================================================

def get_peers(ticker: str, info: dict) -> dict:
    try:
        peer_tickers = []

        if FINNHUB_CLIENT:
            try:
                peer_tickers = FINNHUB_CLIENT.company_peers(ticker) or []
                peer_tickers = [p for p in peer_tickers if p != ticker][:5]
            except Exception:
                pass

        if not peer_tickers:
            sector_map = {
                "Technology": ["AAPL", "MSFT", "GOOGL", "META", "AMZN"],
                "Semiconductors": ["AMD", "INTC", "QCOM", "AVGO", "TSM"],
                "Financial Services": ["JPM", "BAC", "GS", "MS", "C"],
                "Healthcare": ["JNJ", "PFE", "MRK", "ABBV", "UNH"],
                "Consumer Cyclical": ["AMZN", "TSLA", "HD", "NKE", "MCD"],
            }
            sector = info.get("sector", "Technology")
            industry = info.get("industry", "")
            if "Semiconductor" in industry:
                peer_tickers = [p for p in sector_map["Semiconductors"] if p != ticker][:5]
            else:
                peer_tickers = [p for p in sector_map.get(sector, sector_map["Technology"]) if p != ticker][:5]

        def fetch_peer(t):
            try:
                i = yf.Ticker(t).info
                rev = i.get("totalRevenue")
                prev_rev = None
                try:
                    inc = yf.Ticker(t).income_stmt
                    rev_row = None
                    for label in ["Total Revenue", "Revenue"]:
                        if label in inc.index:
                            rev_row = inc.loc[label]
                            break
                    if rev_row is not None and len(rev_row) >= 2:
                        vals = [v for v in rev_row.values if not pd.isna(v)]
                        if len(vals) >= 2 and vals[1]:
                            prev_rev = vals[1]
                except Exception:
                    pass
                rev_growth = round((rev - prev_rev) / abs(prev_rev) * 100, 1) if rev and prev_rev and prev_rev != 0 else None
                return {
                    "ticker": t,
                    "name": i.get("shortName", t),
                    "market_cap": i.get("marketCap"),
                    "pe_trailing": i.get("trailingPE"),
                    "pe_forward": i.get("forwardPE"),
                    "ps_ratio": i.get("priceToSalesTrailing12Months"),
                    "ev_ebitda": i.get("enterpriseToEbitda"),
                    "revenue_growth": rev_growth,
                    "gross_margin": round(i.get("grossMargins", 0) * 100, 1) if i.get("grossMargins") else None,
                    "beta": i.get("beta"),
                }
            except Exception:
                return {"ticker": t, "error": "fetch failed"}

        target = {
            "ticker": ticker,
            "name": info.get("shortName", ticker),
            "market_cap": info.get("marketCap"),
            "pe_trailing": info.get("trailingPE"),
            "pe_forward": info.get("forwardPE"),
            "ps_ratio": info.get("priceToSalesTrailing12Months"),
            "ev_ebitda": info.get("enterpriseToEbitda"),
            "revenue_growth": None,
            "gross_margin": round(info.get("grossMargins", 0) * 100, 1) if info.get("grossMargins") else None,
            "beta": info.get("beta"),
            "is_target": True,
        }

        peers = [fetch_peer(p) for p in peer_tickers]
        all_companies = [target] + peers

        sector_pe = [c["pe_trailing"] for c in all_companies if c.get("pe_trailing") and not math.isnan(c["pe_trailing"])]
        sector_avg_pe = round(sum(sector_pe) / len(sector_pe), 1) if sector_pe else None
        target_pe = target.get("pe_trailing")
        premium = round((target_pe - sector_avg_pe) / sector_avg_pe * 100, 1) if target_pe and sector_avg_pe and sector_avg_pe else None

        return {
            "companies": all_companies,
            "sector_avg_pe": sector_avg_pe,
            "premium_discount_to_peers": premium,
        }
    except Exception as e:
        return {"error": str(e)}


# ============================================================
# === MODULE 9: EARNINGS ===
# ============================================================

def get_earnings(stock, info: dict) -> dict:
    try:
        eh = stock.earnings_history
        history = []
        beat_count = miss_count = 0
        surprises = []

        if eh is not None and not eh.empty:
            for period, row in eh.iterrows():
                actual = row.get("epsActual")
                estimate = row.get("epsEstimate")
                surprise = row.get("surprisePercent")
                if actual is None or pd.isna(actual):
                    continue
                beat = None
                if estimate is not None and not pd.isna(estimate):
                    beat = actual >= estimate
                    if beat:
                        beat_count += 1
                    else:
                        miss_count += 1
                if surprise is not None and not pd.isna(surprise):
                    surprises.append(float(surprise) * 100)
                history.append({
                    "period": str(period)[:7],
                    "eps_actual": round(float(actual), 4) if actual else None,
                    "eps_estimate": round(float(estimate), 4) if estimate and not pd.isna(estimate) else None,
                    "surprise_pct": round(float(surprise) * 100, 2) if surprise and not pd.isna(surprise) else None,
                    "beat": beat,
                })

        cal = stock.calendar
        next_date = None
        eps_est = None
        rev_est = None
        if cal is not None:
            if isinstance(cal, dict):
                next_date = str(cal.get("Earnings Date", [None])[0])[:10] if cal.get("Earnings Date") else None
                eps_est = cal.get("EPS Estimate")
                rev_est = cal.get("Revenue Estimate")
            elif hasattr(cal, "loc"):
                try:
                    next_date = str(cal.loc["Earnings Date"].iloc[0])[:10]
                except Exception:
                    pass

        days_until = None
        if next_date and next_date != "None":
            try:
                nd = datetime.strptime(next_date[:10], "%Y-%m-%d")
                days_until = (nd - datetime.now()).days
            except Exception:
                pass

        return {
            "next_earnings_date": next_date if next_date and next_date != "None" else None,
            "days_until_earnings": days_until,
            "eps_estimate_next": eps_est,
            "revenue_estimate_next": rev_est,
            "history": history[:8],
            "avg_surprise_pct": round(sum(surprises) / len(surprises), 2) if surprises else None,
            "beat_count": beat_count,
            "miss_count": miss_count,
            "beat_rate_pct": round(beat_count / (beat_count + miss_count) * 100, 0) if (beat_count + miss_count) > 0 else None,
        }
    except Exception as e:
        return {"error": str(e)}


# ============================================================
# === MODULE 10: ANALYST RATINGS ===
# ============================================================

def get_analyst_ratings(stock, info: dict) -> dict:
    try:
        target_mean = info.get("targetMeanPrice")
        target_high = info.get("targetHighPrice")
        target_low = info.get("targetLowPrice")
        price = info.get("currentPrice") or info.get("regularMarketPrice", 0)
        upside = round((target_mean - price) / price * 100, 1) if target_mean and price else None

        recs = stock.recommendations
        strong_buy = buy = hold = sell = strong_sell = 0
        if recs is not None and not recs.empty:
            latest = recs.iloc[-1]
            strong_buy = int(latest.get("strongBuy", 0))
            buy = int(latest.get("buy", 0))
            hold = int(latest.get("hold", 0))
            sell = int(latest.get("sell", 0))
            strong_sell = int(latest.get("strongSell", 0))

        total = strong_buy + buy + hold + sell + strong_sell
        if total > 0:
            score = (strong_buy * 2 + buy * 1 + hold * 0 + sell * -1 + strong_sell * -2) / total
            consensus = ("Strong Buy" if score > 1.2 else
                         "Buy" if score > 0.4 else
                         "Strong Sell" if score < -1.2 else
                         "Sell" if score < -0.4 else "Hold")
        else:
            consensus = info.get("recommendationKey", "N/A").replace("_", " ").title()

        changes = []
        try:
            upgrades = stock.upgrades_downgrades
            if upgrades is not None and not upgrades.empty:
                for idx, row in upgrades.head(10).iterrows():
                    changes.append({
                        "date": str(idx)[:10],
                        "firm": row.get("Firm", ""),
                        "from_grade": row.get("FromGrade", ""),
                        "to_grade": row.get("ToGrade", ""),
                        "action": row.get("Action", ""),
                    })
        except Exception:
            pass

        return {
            "consensus": consensus,
            "target_price_mean": target_mean,
            "target_price_high": target_high,
            "target_price_low": target_low,
            "upside_pct": upside,
            "strong_buy_count": strong_buy,
            "buy_count": buy,
            "hold_count": hold,
            "sell_count": sell,
            "strong_sell_count": strong_sell,
            "total_analysts": total,
            "recent_changes": changes,
        }
    except Exception as e:
        return {"error": str(e)}


# ============================================================
# === MODULE 11: CONGRESSIONAL TRADES (Quiver Quantitative) ===
# ============================================================
# Real STOCK Act disclosures. Members of the US Congress must publicly file
# their securities trades within 45 days, so the gap between when a trade was
# made and when it was disclosed is itself a signal — a long lag means the
# public learned late. That gap is surfaced per trade (disclosure_lag_days) and
# in the summary (avg/max lag + a notable_flag for the slowest disclosure).
#
# This is a FETCHER (see module-pattern.md, "Rules for a new module"): it takes
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


# ============================================================
# === PREMIUM DEMO MODULES ===
# ============================================================

def get_dark_pool_demo(ticker: str, current_price: float) -> dict:
    p = current_price
    return {
        "demo": True,
        "source": "Unusual Whales (demo — subscribe at unusualwhales.com)",
        "prints_today": [
            {"time": "09:31", "size": 850_000, "price": round(p * 1.004, 2),
             "notional": round(850_000 * p * 1.004), "exchange": "FINRA ADF",
             "vs_price": "above", "signal": "Accumulation"},
            {"time": "10:45", "size": 1_200_000, "price": round(p * 0.993, 2),
             "notional": round(1_200_000 * p * 0.993), "exchange": "FINRA ADF",
             "vs_price": "below", "signal": "Distribution"},
            {"time": "13:02", "size": 2_100_000, "price": round(p * 1.006, 2),
             "notional": round(2_100_000 * p * 1.006), "exchange": "NYSE Arca Off-Exchange",
             "vs_price": "above", "signal": "Accumulation"},
        ],
        "summary": {
            "total_dark_pool_volume": 4_150_000,
            "pct_of_total_volume": 14.2,
            "net_signal": "Accumulation",
            "largest_print_notional": round(2_100_000 * p * 1.006),
            "dp_volume_vs_20d_avg": 2.3,
        },
        "5d_volume": [
            {"date": "2026-06-12", "volume": 1_800_000, "pct_of_total": 9.1},
            {"date": "2026-06-13", "volume": 2_100_000, "pct_of_total": 10.4},
            {"date": "2026-06-14", "volume": 1_650_000, "pct_of_total": 8.7},
            {"date": "2026-06-15", "volume": 3_200_000, "pct_of_total": 12.8},
            {"date": "2026-06-16", "volume": 4_150_000, "pct_of_total": 14.2},
        ],
    }


def get_gex_demo(ticker: str, current_price: float) -> dict:
    p = current_price
    strikes = [round(p * (1 + i * 0.025)) for i in range(-8, 9)]
    gex_by_strike = [
        {"strike": s, "gex": round((s - p) * -120_000 * max(0, 1 - abs(s / p - 1) * 7), 0)}
        for s in strikes
    ]
    return {
        "demo": True,
        "source": "Unusual Whales (demo — subscribe at unusualwhales.com)",
        "current_price": p,
        "net_gex": -2_840_000_000,
        "gex_signal": "Short Gamma",
        "key_levels": {
            "put_wall": round(p * 0.95, 2),
            "call_wall": round(p * 1.075, 2),
            "zero_gamma_level": round(p * 1.01, 2),
            "largest_positive_gex_strike": round(p * 1.05, 2),
        },
        "gex_by_strike": gex_by_strike,
        "interpretation": (
            f"Dealers are net short gamma below ${round(p * 1.01, 0):.0f}. "
            "Price moves are likely amplified — dealers add momentum in either direction. "
            f"Key pin resistance: ${round(p * 1.05, 0):.0f}. "
            f"Put wall support: ${round(p * 0.95, 0):.0f}."
        ),
    }


# ============================================================
# === SYNTHESIZE ENDPOINT ===
# ============================================================

class SynthesisPayload:
    pass


class SynthesisRequest(BaseModel):
    ticker: str
    company_name: str
    section: str
    data: dict

SECTION_PROMPTS = {
    "technicals": "Write the technical analysis section for {name} ({ticker}). Lead with the most important signal. Use specific numbers. 3-5 sentences.\n\nData: {data}",
    "options": "Write the options flow analysis for {name} ({ticker}). Identify the most significant smart money signal. Use specific contract details. 3-5 sentences.\n\nData: {data}",
    "insider": "Write the insider activity interpretation for {name} ({ticker}). What is the net insider sentiment signal? Use specific names and values. 3 sentences.\n\nData: {data}",
    "fundamentals": "Write the fundamental analysis section for {name} ({ticker}). Focus on growth trajectory and margin quality. Use specific numbers. 3-5 sentences.\n\nData: {data}",
    "peers": "Write the relative valuation section for {name} ({ticker}). How does it compare to peers on key multiples? Use specific numbers. 3 sentences.\n\nData: {data}",
    "news": "Write the news sentiment summary for {name} ({ticker}). What is the dominant narrative? 2-3 sentences.\n\nData: {data}",
    "earnings": "Write the earnings quality section for {name} ({ticker}). Focus on beat rate and upcoming catalyst. 3 sentences.\n\nData: {data}",
    "overall": """Write a concise institutional research note for {name} ({ticker}) with these exact sections:

**EXECUTIVE SUMMARY**
[2 sentences — single most important bullish signal vs single most important risk]

**FUNDAMENTAL PICTURE**
[Revenue growth, margin trajectory, balance sheet health — 3 sentences with specific numbers]

**TECHNICAL SETUP**
[Price structure, key levels, momentum — 2-3 sentences]

**SMART MONEY SIGNALS**
[Options flow and insider activity combined — 2-3 sentences]

**RELATIVE VALUE**
[Vs peers on key multiples — 2 sentences]

**KEY RISKS**
- [Risk 1]
- [Risk 2]
- [Risk 3]

**BOTTOM LINE**
[One decisive sentence]

Data: {data}""",
}

@app.post("/synthesize")
async def synthesize(req: SynthesisRequest):
    if not ANTHROPIC_CLIENT.api_key:
        return {"error": "ANTHROPIC_API_KEY not configured"}

    system = (
        "You are a senior sell-side equity research analyst. Write precise, analytical prose. "
        "Use specific numbers from the data provided. No generic disclaimers. "
        "Never fabricate data not in the payload. Be direct and investment-grade in tone."
    )

    template = SECTION_PROMPTS.get(req.section, SECTION_PROMPTS["overall"])
    user_msg = template.format(
        name=req.company_name,
        ticker=req.ticker,
        data=json.dumps(req.data, default=str)[:6000]
    )

    def stream_response():
        with ANTHROPIC_CLIENT.messages.stream(
            model="claude-sonnet-4-6",
            max_tokens=600,
            system=system,
            messages=[{"role": "user", "content": user_msg}]
        ) as stream:
            for text in stream.text_stream:
                yield f"data: {json.dumps({'token': text})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(stream_response(), media_type="text/event-stream")


# ============================================================
# === NUMA CHAT PROXY ===
# ============================================================
# Browsers cannot call api.anthropic.com directly (CORS), so Numa's chat is
# proxied here: the frontend posts the user's key + conversation to this local
# backend, which streams the Claude response back as SSE (server->Anthropic has
# no CORS). Emits {token}, then {usage}, then [DONE]; {error} on failure.

class NumaRequest(BaseModel):
    api_key: str
    system: str = ""
    messages: List[Any]
    max_tokens: int = 8192
    model: str = "claude-sonnet-4-6"


@app.post("/numa")
def numa_chat(req: NumaRequest):
    def gen():
        try:
            client = anthropic.Anthropic(api_key=req.api_key)
            with client.messages.stream(
                model=req.model,
                max_tokens=req.max_tokens,
                system=req.system or "",
                messages=req.messages,
            ) as stream:
                for text in stream.text_stream:
                    yield f"data: {json.dumps({'token': text})}\n\n"
                final = stream.get_final_message()
                usage = getattr(final, "usage", None)
                if usage is not None:
                    yield f"data: {json.dumps({'usage': {'input_tokens': usage.input_tokens, 'output_tokens': usage.output_tokens}})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream")


# ============================================================
# === MACRO LAYER ===
# ============================================================
# A free macro-economic layer: rates, labor, inflation, growth, market
# conditions, market-implied Fed probabilities and an events calendar.
# All data from FRED (free, https://fred.stlouisfed.org) and yfinance
# (indices only). Cached for 1 hour to avoid hammering FRED on every load.

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


@app.get("/macro")
def get_macro():
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


# ============================================================
# === SYMBOL SEARCH (ticker autocomplete) ===
# ============================================================
# Powers the ticker-input typeahead: type a company name OR a partial
# symbol and get back matching tickers as you type. Uses Yahoo Finance's
# public search endpoint (no API key required, same source as the quotes),
# lightly ranked to favour the obvious US-listed match, and cached briefly
# so repeated keystrokes stay snappy.

_SEARCH_CACHE = {}          # query(lower) -> (timestamp, results)
_SEARCH_TTL = 600           # seconds — names/symbols barely change

# Yahoo quoteType values we surface. Stocks/ETFs/indexes/funds/crypto are what
# this terminal analyzes; futures and FX pairs are dropped (they're just noise
# for queries like "micro" and the analyze pipeline isn't built around them).
_SEARCH_TYPES = {"EQUITY", "ETF", "INDEX", "MUTUALFUND", "CRYPTOCURRENCY"}
# Yahoo `exchange` codes for a primary US common-stock listing (NASDAQ/NYSE/AMEX).
# Used only to boost ranking, so the obvious mega-cap beats foreign cross-listings.
_US_PRIMARY = {"NMS", "NYQ", "NGM", "NCM", "ASE"}
# Substrings that mark a leveraged/inverse product — these often squat on a short
# ticker (NVD, TESL) and shouldn't outrank the company the user is clearly after.
_LEVERAGED = (" 2x", " 3x", "short", "leverage", "inverse", "bull ", "bear ", "daily")
_SEARCH_UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
              "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")


def _alnum(s):
    """Lowercase, alphanumeric-only — so 'coca cola' matches 'Coca-Cola'."""
    return "".join(ch for ch in (s or "").lower() if ch.isalnum())


@app.get("/search")
def symbol_search(q: str = "", limit: int = 8):
    """Ticker suggestions for a company-name or partial-symbol query.

    Returns {query, results:[{symbol, name, type, exchange}]}, best match first.
    Degrades to an empty list (never raises) so the frontend typeahead can
    silently fall back to "analyze whatever was typed" when offline."""
    q = (q or "").strip()
    if not q:
        return {"query": q, "results": []}

    key = q.lower()
    now = time.time()
    cached = _SEARCH_CACHE.get(key)
    if cached and now - cached[0] < _SEARCH_TTL:
        return {"query": q, "results": cached[1][:limit]}

    ranked = []
    try:
        # Yahoo 429s the plain `requests` client (TLS fingerprinting), so use
        # curl_cffi's browser impersonation — the same trick yfinance relies on.
        params = {"q": q, "quotesCount": 20, "newsCount": 0,
                  "listsCount": 0, "enableFuzzyQuery": "false"}
        url = "https://query2.finance.yahoo.com/v1/finance/search"
        try:
            from curl_cffi import requests as _creq
            r = _creq.get(url, params=params, impersonate="chrome", timeout=6)
        except Exception:
            r = requests.get(url, params=params,
                             headers={"User-Agent": _SEARCH_UA, "Accept": "application/json"},
                             timeout=6)
        data = r.json()
        ql = q.lower()
        qa = _alnum(ql)
        quotes = data.get("quotes", [])
        n = len(quotes)
        for idx, it in enumerate(quotes):
            sym = (it.get("symbol") or "").strip().upper()
            qtype = (it.get("quoteType") or "").upper()
            if not sym or qtype not in _SEARCH_TYPES:
                continue
            name = (it.get("shortname") or it.get("longname")
                    or it.get("name") or "").strip()
            exch = (it.get("exchDisp") or it.get("exchange") or "").strip()
            sl = sym.lower()
            slc = sl.lstrip("^")                        # index symbols are "^vix" — match the core
            qlc = ql.lstrip("^")
            na = _alnum(name)

            # Yahoo already orders by popularity — keep that as the spine, then
            # nudge toward the "obvious" pick: a primary US-listed common stock
            # whose ticker or name the query prefixes. Foreign cross-listings
            # (".XX" suffixes) and leveraged/inverse ETFs get pushed down.
            score = (n - idx) * 3                       # Yahoo's own ranking prior
            if slc == qlc:
                score += 45
            elif slc.startswith(qlc):
                score += 32
            elif qlc and qlc in slc:
                score += 12
            if qa and na.startswith(qa):
                score += 36
            elif qa and qa in na:
                score += 12
            if qtype == "EQUITY" and (it.get("exchange") or "") in _US_PRIMARY:
                score += 42
            elif qtype == "EQUITY":
                score += 10
            elif qtype in ("ETF", "INDEX"):
                score += 12
            if "." not in sym:
                score += 16
            if any(w in name.lower() for w in _LEVERAGED):
                score -= 34

            ranked.append((score, {"symbol": sym, "name": name,
                                    "type": qtype.title(), "exchange": exch}))
    except Exception as e:
        return {"query": q, "results": [], "error": str(e)}

    ranked.sort(key=lambda x: -x[0])
    # Dedupe by symbol, keeping the highest-scored entry.
    seen, results = set(), []
    for _, item in ranked:
        if item["symbol"] in seen:
            continue
        seen.add(item["symbol"])
        results.append(item)

    _SEARCH_CACHE[key] = (now, results)
    return {"query": q, "results": results[:limit]}


# ============================================================
# === STATIC FILES (manifest, icons, sw.js) ===
# ============================================================
# Serves any asset in the project directory under /static.
# This MUST come AFTER all explicit route definitions — a mount is a
# catch-all that would otherwise shadow the routes declared above.
app.mount(
    "/static",
    StaticFiles(directory=str(BASE_DIR)),
    name="static",
)
