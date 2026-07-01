# ============================================================
# === ANALYZE ENDPOINTS (full JSON + streaming SSE) ===
# ============================================================
# The two per-ticker analysis endpoints. Both fetch the base
# yf.Ticker(...) / .info once and dispatch the data modules
# sequentially, one at a time (see docs/module-pattern.md).

import json
from datetime import datetime

import yfinance as yf
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.utils import _json_safe
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

router = APIRouter()


# ============================================================
# === MAIN ANALYZE ENDPOINT ===
# ============================================================

@router.get("/analyze/{ticker}")
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


@router.get("/analyze/stream/{ticker}")
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
