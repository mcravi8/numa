"""Earnings module: EPS beat/miss history and the next earnings date.

Transformer over the caller's ``stock`` handle and ``info`` bag
(see docs/module-pattern.md).
"""
# ============================================================
# === MODULE 9: EARNINGS ===
# ============================================================

from datetime import datetime

import pandas as pd
import yfinance as yf

from app.config import logger


def get_earnings(stock: yf.Ticker, info: dict) -> dict:
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
                except Exception as exc:
                    logger.debug("earnings calendar parse failed", exc_info=exc)

        days_until = None
        if next_date and next_date != "None":
            try:
                nd = datetime.strptime(next_date[:10], "%Y-%m-%d")
                days_until = (nd - datetime.now()).days
            except Exception as exc:
                logger.debug("earnings date parse failed for %r", next_date, exc_info=exc)

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
