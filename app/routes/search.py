"""Symbol search (ticker autocomplete) via Yahoo's public search endpoint, plus
the /health probe. Search degrades to an empty list (never raises) so the
frontend typeahead can fall back to analyzing whatever was typed.
"""
# ============================================================
# === SYMBOL SEARCH (ticker autocomplete) + HEALTH ===
# ============================================================
# The typeahead: type a company name OR a partial symbol and get back
# matching tickers as you type. Uses Yahoo Finance's public search
# endpoint (no API key required, same source as the quotes), lightly
# ranked to favour the obvious US-listed match, and cached briefly so
# repeated keystrokes stay snappy. Also hosts the /health probe.

import time
from datetime import datetime

import requests
from fastapi import APIRouter

router = APIRouter()


# ============================================================
# === HEALTH ===
# ============================================================

@router.get("/health")
def health() -> dict:
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat()}


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


@router.get("/search")
def symbol_search(q: str = "", limit: int = 8) -> dict:
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
