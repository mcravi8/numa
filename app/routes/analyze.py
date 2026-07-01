"""Analyze endpoints: the full-JSON /analyze/{ticker} and the streaming SSE
/analyze/stream/{ticker}. Both are driven by one ordered MODULE_REGISTRY so a
new data module is registered in exactly one place (see docs/module-pattern.md).
"""
# ============================================================
# === ANALYZE ENDPOINTS (full JSON + streaming SSE) ===
# ============================================================
# The two per-ticker analysis endpoints. Both fetch the base
# yf.Ticker(...) / .info once and dispatch the data modules
# sequentially, one at a time (see docs/module-pattern.md).
#
# Both endpoints are driven by ONE ordered registry, MODULE_REGISTRY, so a
# future module is registered in exactly one place and flows to both endpoints
# automatically. Each entry is a ModuleSpec(key, label, premium, fetch):
#
#   key      the result slot / SSE "module" name (e.g. "options_flow")
#   label    the UI progress-row label used by the stream (e.g. "Options Chain")
#   premium  True for the demo premium modules (only run when mode == "premium")
#   fetch    a signature adapter: given the per-request Ctx, call the underlying
#            get_* module with whatever arguments it happens to take (the nine
#            modules have six different call signatures — see module-pattern.md).
#
# The two endpoints consume the registry differently, and that difference is
# deliberate and client-observable, so it is preserved exactly:
#
#   * analyze() emits its JSON keys in REGISTRY order — company … analyst_ratings,
#     then the premium keys — matching the original response's key order.
#   * analyze_stream() emits SSE events in LABEL-GROUPED order: modules sharing a
#     label stream under one progress row (first-appearance order). This is what
#     moves analyst_ratings ("Financials") up next to financials in the stream
#     while it stays last in analyze()'s JSON. See _group_by_label().

import json
from collections import namedtuple
from datetime import datetime

import yfinance as yf
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.modules.company import get_company
from app.modules.congress import get_congressional_trades
from app.modules.earnings import get_earnings
from app.modules.financials import get_financials
from app.modules.insider import get_insider_activity
from app.modules.news import get_news_sentiment
from app.modules.options import get_options_flow
from app.modules.peers import get_peers
from app.modules.premium_demo import get_dark_pool_demo, get_gex_demo
from app.modules.quote import get_quote
from app.modules.ratings import get_analyst_ratings
from app.modules.technicals import get_technicals
from app.utils import _json_safe

router = APIRouter()


# ============================================================
# === MODULE REGISTRY (single source of truth for both endpoints) ===
# ============================================================

# Per-request context handed to every module's signature adapter. current_price
# is computed per endpoint (the two endpoints derive it differently — see below)
# and only consumed by the premium demo modules.
Ctx = namedtuple("Ctx", ["stock", "info", "ticker", "mode", "current_price"])

# key, label, premium flag, and a signature adapter over Ctx.
ModuleSpec = namedtuple("ModuleSpec", ["key", "label", "premium", "fetch"])

# Ordered exactly like the original analyze() response's module keys. A new
# module is added here once, at the end, and appears in both endpoints.
MODULE_REGISTRY = [
    ModuleSpec("company",              "Quote & Profile", False, lambda c: get_company(c.info)),
    ModuleSpec("quote",                "Quote & Profile", False, lambda c: get_quote(c.info, c.mode)),
    ModuleSpec("financials",           "Financials",      False, lambda c: get_financials(c.stock, c.info)),
    ModuleSpec("technicals",           "Technicals",      False, lambda c: get_technicals(c.stock)),
    ModuleSpec("options_flow",         "Options Chain",   False, lambda c: get_options_flow(c.stock, c.info, c.mode)),
    ModuleSpec("insider_activity",     "Insider Filings", False, lambda c: get_insider_activity(c.ticker)),
    ModuleSpec("news_sentiment",       "News",            False, lambda c: get_news_sentiment(c.ticker)),
    ModuleSpec("peers",                "Peer Comparison", False, lambda c: get_peers(c.ticker, c.info)),
    ModuleSpec("earnings",             "Earnings",        False, lambda c: get_earnings(c.stock, c.info)),
    ModuleSpec("analyst_ratings",      "Financials",      False, lambda c: get_analyst_ratings(c.stock, c.info)),
    ModuleSpec("dark_pool",            "Dark Pool",       True,  lambda c: get_dark_pool_demo(c.ticker, c.current_price)),
    ModuleSpec("gamma_exposure",       "Gamma Exposure",  True,  lambda c: get_gex_demo(c.ticker, c.current_price)),
    ModuleSpec("congressional_trades", "Congress",        True,  lambda c: get_congressional_trades(c.ticker)),
]


def _group_by_label(specs):
    """Reorder specs so entries sharing a UI label stream consecutively, under a
    single progress row, in first-appearance order of the label. This is what
    the streaming endpoint uses so analyst_ratings (label "Financials") streams
    next to financials, exactly as the original hand-written STREAM_MODULES did,
    while analyze()'s JSON keeps registry order."""
    groups, index = [], {}
    for s in specs:
        if s.label in index:
            groups[index[s.label]].append(s)
        else:
            index[s.label] = len(groups)
            groups.append([s])
    return [s for group in groups for s in group]


# ============================================================
# === MAIN ANALYZE ENDPOINT ===
# ============================================================

@router.get("/analyze/{ticker}")
def analyze(ticker: str, mode: str = "free") -> dict:
    ticker = ticker.upper().strip()

    # Fixed key order: metadata, then every module key in registry order, then
    # error — matching the original response exactly (premium keys stay None in
    # free mode). Pre-inserting the keys makes the JSON order independent of
    # which modules actually run.
    result = {"ticker": ticker, "mode": mode, "timestamp": datetime.utcnow().isoformat()}
    for spec in MODULE_REGISTRY:
        result[spec.key] = None
    result["error"] = None

    try:
        stock = yf.Ticker(ticker)
        info = stock.info
        if not info or not info.get("longName"):
            result["error"] = f"Ticker '{ticker}' not found or no data available."
            return result

        ctx = Ctx(stock=stock, info=info, ticker=ticker, mode=mode,
                  current_price=info.get("currentPrice", 100.0))

        for spec in MODULE_REGISTRY:
            if spec.premium and mode != "premium":
                continue
            result[spec.key] = spec.fetch(ctx)

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

@router.get("/analyze/stream/{ticker}")
def analyze_stream(ticker: str, mode: str = "free") -> StreamingResponse:
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
            ctx = Ctx(stock=stock, info=info, ticker=ticker, mode=mode,
                      current_price=current_price)

            # Stream free modules first (label-grouped), then premium modules
            # (only in premium mode). Grouping by label reproduces the original
            # STREAM_MODULES ordering, where analyst_ratings rides under the
            # "Financials" row right after financials.
            free = _group_by_label([s for s in MODULE_REGISTRY if not s.premium])
            premium = _group_by_label([s for s in MODULE_REGISTRY if s.premium])
            stream_specs = free + (premium if mode == "premium" else [])

            for spec in stream_specs:
                yield sse({"module": spec.key, "label": spec.label, "status": "fetching"})
                try:
                    data = spec.fetch(ctx)
                except Exception as e:
                    data = {"error": str(e)}
                yield sse({"module": spec.key, "label": spec.label, "status": "done", "data": data})

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
