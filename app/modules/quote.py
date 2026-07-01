"""Quote module: price, valuation, and extended-hours fields from ``info``.

Transformer over the caller's pre-fetched ``info`` bag; adds demo bid/ask/VWAP
fields in premium mode (see docs/module-pattern.md).
"""
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
