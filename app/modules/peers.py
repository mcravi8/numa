# ============================================================
# === MODULE 8: PEERS ===
# ============================================================

import math
import pandas as pd
import yfinance as yf

from app.config import FINNHUB_CLIENT


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
