"""Options-flow module: per-expiry volume/OI, unusual contracts, and max pain.

Transformer over the caller's ``stock`` handle and ``info`` bag; adds a demo
premium-flow block in premium mode (see docs/module-pattern.md).
"""
# ============================================================
# === MODULE 5: OPTIONS FLOW ===
# ============================================================

from datetime import datetime

import pandas as pd
import yfinance as yf

from app.config import logger
from app.modules.premium_demo import get_options_flow_premium_demo


def get_options_flow(stock: yf.Ticker, info: dict, mode: str = "free") -> dict:
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
        except Exception as exc:
            logger.debug("max-pain calc failed", exc_info=exc)

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
