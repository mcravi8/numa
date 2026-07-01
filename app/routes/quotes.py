"""Live quote endpoints: a single real-time quote for the price ticker and a
batch endpoint for the favorites watchlist. Both read yfinance's cheap fast_info
so the frontend can poll them frequently.
"""
# ============================================================
# === LIVE QUOTE ENDPOINTS ===
# ============================================================
# Lightweight real quotes for the price ticker (single) and the
# favorites watchlist (batch). Both read from yfinance's cheap
# fast_info so the frontend can poll them frequently.

import yfinance as yf
from fastapi import APIRouter

from app.config import logger
from app.utils import _json_safe, _ovr

router = APIRouter()


@router.get("/quote/{ticker}")
def live_quote(ticker: str) -> dict:
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
        except Exception as exc:
            logger.debug("fast_info unavailable for %s, falling back to .info", ticker, exc_info=exc)
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


@router.get("/quotes")
def batch_quotes(symbols: str = "", names: str = "") -> dict:
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
            except Exception as exc:
                logger.debug("fast_info unavailable for %s", sym, exc_info=exc)
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
        except Exception as exc:
            logger.debug("batch quote failed for %s", sym, exc_info=exc)
        return q

    out = {}
    if syms:
        with ThreadPoolExecutor(max_workers=min(12, len(syms))) as ex:
            for q in ex.map(one, syms):
                out[q["symbol"]] = q
    return _json_safe({"quotes": out})
