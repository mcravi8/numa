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
import yfinance as yf
from datetime import datetime
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
    FRED_KEY,
    NOTES_FILE,
)
from app.utils import _json_safe, _ovr
from app.modules.company import get_company
from app.modules.quote import get_quote
from app.modules.financials import get_financials
from app.modules.technicals import get_technicals
from app.modules.options import get_options_flow
from app.modules.insider import get_insider_activity
from app.modules.news import get_news_sentiment
from app.modules.peers import get_peers
from app.modules.earnings import get_earnings
from app.modules.ratings import get_analyst_ratings
from app.modules.congress import get_congressional_trades
from app.modules.premium_demo import get_dark_pool_demo, get_gex_demo

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
