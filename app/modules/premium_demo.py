# ============================================================
# === PREMIUM DEMO MODULES ===
# ============================================================


def get_options_flow_premium_demo() -> dict:
    return {
        "demo": True,
        "source": "Unusual Whales (demo)",
        "bullish_premium_today": 47_320_000,
        "bearish_premium_today": 12_840_000,
        "net_flow": 34_480_000,
        "flow_sentiment": "Strong Bullish",
        "5d_trend": [
            {"date": "2026-06-12", "net": 8_200_000},
            {"date": "2026-06-13", "net": 15_400_000},
            {"date": "2026-06-14", "net": -3_100_000},
            {"date": "2026-06-15", "net": 22_600_000},
            {"date": "2026-06-16", "net": 34_480_000},
        ],
        "flow_alerts": [
            {"time": "09:47:23", "type": "call", "strike": None, "expiry": "2026-07-18",
             "size": 2500, "premium": 1_875_000, "execution": "sweep",
             "sentiment": "Bullish", "flags": ["Sweep", "Large Premium", "OTM"]},
            {"time": "10:12:05", "type": "call", "strike": None, "expiry": "2026-08-15",
             "size": 5000, "premium": 3_250_000, "execution": "block",
             "sentiment": "Very Bullish", "flags": ["Block Trade", "Deep OTM", "Large Premium"]},
            {"time": "11:33:50", "type": "put", "strike": None, "expiry": "2026-07-18",
             "size": 1800, "premium": 720_000, "execution": "sweep",
             "sentiment": "Bearish", "flags": ["Sweep", "OTM", "Hedge Signal"]},
        ],
    }


def get_dark_pool_demo(ticker: str, current_price: float) -> dict:
    p = current_price
    return {
        "demo": True,
        "source": "Unusual Whales (demo — subscribe at unusualwhales.com)",
        "prints_today": [
            {"time": "09:31", "size": 850_000, "price": round(p * 1.004, 2),
             "notional": round(850_000 * p * 1.004), "exchange": "FINRA ADF",
             "vs_price": "above", "signal": "Accumulation"},
            {"time": "10:45", "size": 1_200_000, "price": round(p * 0.993, 2),
             "notional": round(1_200_000 * p * 0.993), "exchange": "FINRA ADF",
             "vs_price": "below", "signal": "Distribution"},
            {"time": "13:02", "size": 2_100_000, "price": round(p * 1.006, 2),
             "notional": round(2_100_000 * p * 1.006), "exchange": "NYSE Arca Off-Exchange",
             "vs_price": "above", "signal": "Accumulation"},
        ],
        "summary": {
            "total_dark_pool_volume": 4_150_000,
            "pct_of_total_volume": 14.2,
            "net_signal": "Accumulation",
            "largest_print_notional": round(2_100_000 * p * 1.006),
            "dp_volume_vs_20d_avg": 2.3,
        },
        "5d_volume": [
            {"date": "2026-06-12", "volume": 1_800_000, "pct_of_total": 9.1},
            {"date": "2026-06-13", "volume": 2_100_000, "pct_of_total": 10.4},
            {"date": "2026-06-14", "volume": 1_650_000, "pct_of_total": 8.7},
            {"date": "2026-06-15", "volume": 3_200_000, "pct_of_total": 12.8},
            {"date": "2026-06-16", "volume": 4_150_000, "pct_of_total": 14.2},
        ],
    }


def get_gex_demo(ticker: str, current_price: float) -> dict:
    p = current_price
    strikes = [round(p * (1 + i * 0.025)) for i in range(-8, 9)]
    gex_by_strike = [
        {"strike": s, "gex": round((s - p) * -120_000 * max(0, 1 - abs(s / p - 1) * 7), 0)}
        for s in strikes
    ]
    return {
        "demo": True,
        "source": "Unusual Whales (demo — subscribe at unusualwhales.com)",
        "current_price": p,
        "net_gex": -2_840_000_000,
        "gex_signal": "Short Gamma",
        "key_levels": {
            "put_wall": round(p * 0.95, 2),
            "call_wall": round(p * 1.075, 2),
            "zero_gamma_level": round(p * 1.01, 2),
            "largest_positive_gex_strike": round(p * 1.05, 2),
        },
        "gex_by_strike": gex_by_strike,
        "interpretation": (
            f"Dealers are net short gamma below ${round(p * 1.01, 0):.0f}. "
            "Price moves are likely amplified — dealers add momentum in either direction. "
            f"Key pin resistance: ${round(p * 1.05, 0):.0f}. "
            f"Put wall support: ${round(p * 0.95, 0):.0f}."
        ),
    }
