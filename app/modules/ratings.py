"""Analyst-ratings module: consensus, price targets, recent rating changes.

Transformer over the caller's ``stock`` handle and ``info`` bag
(see docs/module-pattern.md).
"""
# ============================================================
# === MODULE 10: ANALYST RATINGS ===
# ============================================================

import yfinance as yf

from app.config import logger


def get_analyst_ratings(stock: yf.Ticker, info: dict) -> dict:
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
        except Exception as exc:
            logger.debug("analyst upgrades/downgrades history unavailable", exc_info=exc)

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
