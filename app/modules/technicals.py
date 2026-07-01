"""Technicals module: SMA/RSI/MACD/Bollinger plus Fibonacci, regression channel,
candle/chart patterns, and historical P/E overlays.

Transformer over the caller's ``stock`` handle; every ``compute_*`` overlay
degrades to None/[] rather than raising (see docs/module-pattern.md).
"""
# ============================================================
# === MODULE 4: TECHNICALS ===
# ============================================================

import math

import numpy as np
import pandas as pd
import yfinance as yf

from app.config import logger
from app.utils import _ovr

# --- Overlay geometry: Fibonacci, psychological levels, regression channel,
# --- candlestick + chart patterns, and historical P/E. All deterministic,
# --- computed from the SAME OHLCV the chart draws so the on-chart overlays and
# --- Numa's prose cite identical numbers. Every helper degrades to None/[] on
# --- bad data and never raises into get_technicals. _ovr() rounds for JSON and
# --- returns None on NaN/Inf (Starlette renders with allow_nan=False).

def _fib_label(r):
    s = f"{r * 100:.1f}"
    if s.endswith(".0"):
        s = s[:-2]
    return s + "%"


def compute_fibonacci(hist, lookback=120):
    """Fib retracement off the dominant swing in the last `lookback` bars.
    Direction = which extreme is more recent: 'up' (low→high, levels are pullback
    supports below the high) or 'down' (high→low, levels are resistances)."""
    try:
        h = hist.iloc[-lookback:]
        highs, lows = h["High"], h["Low"]
        hi, lo = float(highs.max()), float(lows.min())
        hi_idx, lo_idx = highs.idxmax(), lows.idxmin()
        if hi <= lo:
            return None
        rng = hi - lo
        if hi_idx >= lo_idx:
            direction = "up"
            price_of = lambda r: hi - r * rng
        else:
            direction = "down"
            price_of = lambda r: lo + r * rng
        ratios = [0.0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0]
        return {
            "swing_high": _ovr(hi), "swing_low": _ovr(lo),
            "high_date": hi_idx.strftime("%Y-%m-%d"),
            "low_date": lo_idx.strftime("%Y-%m-%d"),
            "direction": direction, "lookback_days": int(len(h)),
            "levels": [{"ratio": r, "label": _fib_label(r), "price": _ovr(price_of(r))}
                       for r in ratios],
        }
    except Exception:
        return None


def compute_psych_levels(price, span=0.12):
    """Round-number levels within ±span of price. Picks the largest 'nice' step
    (mag, mag/2, mag/4, mag/5, mag/10, mag/20) that yields 3–7 levels."""
    try:
        price = float(price)
        if price <= 0:
            return []
        mag = 10 ** math.floor(math.log10(price))
        lo, hi = price * (1 - span), price * (1 + span)
        best = []
        for step in [mag, mag / 2, mag / 4, mag / 5, mag / 10, mag / 20]:
            if step <= 0:
                continue
            lv, v = [], math.floor(lo / step) * step
            while v <= hi + 1e-9:
                if v > 0 and abs(v - price) / price <= span + 1e-9:
                    lv.append(round(v, 2))
                v += step
            if 3 <= len(lv) <= 7:
                return lv
            if len(lv) > len(best) and len(lv) <= 9:
                best = lv
        return best[:8]
    except Exception:
        return []


def compute_regression_channel(hist, lookback=120, k=2.0):
    """Linear-regression channel: least-squares line through close ± k·σ of the
    residuals. Deterministic 'where price is moving' band. Returns the three
    lines as start/end endpoints (the chart draws each as a 2-point segment)."""
    try:
        h = hist.iloc[-lookback:]
        closes = h["Close"].astype(float).values
        n = len(closes)
        if n < 20:
            return None
        x = np.arange(n)
        slope, intercept = np.polyfit(x, closes, 1)
        fit = slope * x + intercept
        sd = float(np.std(closes - fit))
        mid_s, mid_e = float(fit[0]), float(fit[-1])
        last = float(closes[-1])
        band = 2 * k * sd
        pos = (last - (mid_e - k * sd)) / band if band else 0.5
        position = "upper third" if pos > 0.66 else ("lower third" if pos < 0.34 else "mid channel")
        slope_pct = (slope * 252) / fit[0] * 100 if fit[0] else None
        return {
            "lookback_days": int(n),
            "start_date": h.index[0].strftime("%Y-%m-%d"),
            "end_date": h.index[-1].strftime("%Y-%m-%d"),
            "mid_start": _ovr(mid_s), "mid_end": _ovr(mid_e),
            "upper_start": _ovr(mid_s + k * sd), "upper_end": _ovr(mid_e + k * sd),
            "lower_start": _ovr(mid_s - k * sd), "lower_end": _ovr(mid_e - k * sd),
            "k": k, "std": _ovr(sd),
            "trend": "rising" if slope > 0 else ("falling" if slope < 0 else "flat"),
            "slope_pct_annual": round(float(slope_pct), 1) if slope_pct is not None and not math.isnan(slope_pct) else None,
            "position": position,
        }
    except Exception:
        return None


def compute_candle_patterns(hist, window=60):
    """Deterministic single/two-candle reversal patterns over the last `window`
    bars. Reliable to DETECT (simple OHLC geometry); modest predictive value, so
    framed as 'what just printed'. Returns the most recent ~12 to limit markers."""
    try:
        h = hist.iloc[-window:]
        o = h["Open"].astype(float).values
        hi = h["High"].astype(float).values
        lo = h["Low"].astype(float).values
        c = h["Close"].astype(float).values
        dates = [d.strftime("%Y-%m-%d") for d in h.index]
        out = []
        for i in range(len(c)):
            rng = hi[i] - lo[i]
            if rng <= 0:
                continue
            body = abs(c[i] - o[i])
            upsh = hi[i] - max(o[i], c[i])
            dnsh = min(o[i], c[i]) - lo[i]
            up = c[i] >= o[i]
            prior = c[max(0, i - 5):i]
            downtrend = len(prior) >= 3 and c[i - 1] < prior.mean()
            uptrend = len(prior) >= 3 and c[i - 1] > prior.mean()
            pat = direction = None
            if body <= 0.1 * rng:
                pat, direction = "Doji", "neutral"
            elif dnsh >= 2 * body and upsh <= body:
                pat, direction = ("Hammer", "bullish") if downtrend else ("Hanging Man", "bearish")
            elif upsh >= 2 * body and dnsh <= body:
                pat, direction = ("Shooting Star", "bearish") if uptrend else ("Inverted Hammer", "bullish")
            if i > 0:
                pbody = abs(c[i - 1] - o[i - 1])
                prev_up = c[i - 1] >= o[i - 1]
                if up and not prev_up and c[i] >= o[i - 1] and o[i] <= c[i - 1] and body > pbody:
                    pat, direction = "Bullish Engulfing", "bullish"
                elif (not up) and prev_up and o[i] >= c[i - 1] and c[i] <= o[i - 1] and body > pbody:
                    pat, direction = "Bearish Engulfing", "bearish"
            if pat:
                out.append({"date": dates[i], "pattern": pat, "direction": direction})
        return out[-12:]
    except Exception:
        return []


def _find_pivots(values, order=5):
    highs, lows = [], []
    n = len(values)
    for i in range(order, n - order):
        seg = values[i - order:i + order + 1]
        if values[i] == seg.max():
            if not highs or i - highs[-1][0] > order:
                highs.append((i, float(values[i])))
        if values[i] == seg.min():
            if not lows or i - lows[-1][0] > order:
                lows.append((i, float(values[i])))
    return highs, lows


def compute_chart_patterns(hist, lookback=180):
    """Best-effort detection of named formations (double top/bottom, head &
    shoulders, cup & handle) via swing-pivot geometry. These are INHERENTLY
    noisy — returned as low-confidence CANDIDATES with a confidence score for
    Numa to validate/reject, never asserted as fact. Empty list when nothing fits."""
    try:
        h = hist.iloc[-lookback:]
        close = h["Close"].astype(float).values
        dates = [d.strftime("%Y-%m-%d") for d in h.index]
        n = len(close)
        if n < 40:
            return []
        order = max(3, n // 30)
        highs, lows = _find_pivots(close, order=order)
        cands = []

        if len(highs) >= 2:
            (i1, v1), (i2, v2) = highs[-2], highs[-1]
            mid = close[i1:i2]
            if len(mid):
                trough = float(mid.min())
                if abs(v1 - v2) / max(v1, v2) < 0.04 and (min(v1, v2) - trough) / min(v1, v2) > 0.03:
                    target = trough - (max(v1, v2) - trough)
                    cands.append({"pattern": "Double Top", "direction": "bearish",
                                  "confidence": round(1 - abs(v1 - v2) / max(v1, v2) / 0.08, 2),
                                  "neckline": _ovr(trough), "target": _ovr(target),
                                  "dates": [dates[i1], dates[i2]],
                                  "note": "Twin peaks ~%.2f/%.2f; a break below the %.2f neckline projects ~%.2f." % (v1, v2, trough, target)})
        if len(lows) >= 2:
            (i1, v1), (i2, v2) = lows[-2], lows[-1]
            mid = close[i1:i2]
            if len(mid):
                peak = float(mid.max())
                if abs(v1 - v2) / max(v1, v2) < 0.04 and (peak - max(v1, v2)) / max(v1, v2) > 0.03:
                    target = peak + (peak - min(v1, v2))
                    cands.append({"pattern": "Double Bottom", "direction": "bullish",
                                  "confidence": round(1 - abs(v1 - v2) / max(v1, v2) / 0.08, 2),
                                  "neckline": _ovr(peak), "target": _ovr(target),
                                  "dates": [dates[i1], dates[i2]],
                                  "note": "Twin troughs ~%.2f/%.2f; a break above the %.2f neckline projects ~%.2f." % (v1, v2, peak, target)})
        if len(highs) >= 3:
            (iL, vL), (iH, vH), (iR, vR) = highs[-3], highs[-2], highs[-1]
            if vH > vL and vH > vR and abs(vL - vR) / max(vL, vR) < 0.05:
                neck = (float(close[iL:iH].min()) + float(close[iH:iR].min())) / 2
                target = neck - (vH - neck)
                cands.append({"pattern": "Head & Shoulders", "direction": "bearish",
                              "confidence": round(0.7 - abs(vL - vR) / max(vL, vR) / 0.05 * 0.3, 2),
                              "neckline": _ovr(neck), "target": _ovr(target),
                              "dates": [dates[iL], dates[iH], dates[iR]],
                              "note": "Head %.2f between shoulders %.2f/%.2f; neckline %.2f, downside target ~%.2f." % (vH, vL, vR, neck, target)})
        if len(lows) >= 3:
            (iL, vL), (iH, vH), (iR, vR) = lows[-3], lows[-2], lows[-1]
            if vH < vL and vH < vR and abs(vL - vR) / max(vL, vR) < 0.05:
                neck = (float(close[iL:iH].max()) + float(close[iH:iR].max())) / 2
                target = neck + (neck - vH)
                cands.append({"pattern": "Inverse Head & Shoulders", "direction": "bullish",
                              "confidence": round(0.7 - abs(vL - vR) / max(vL, vR) / 0.05 * 0.3, 2),
                              "neckline": _ovr(neck), "target": _ovr(target),
                              "dates": [dates[iL], dates[iH], dates[iR]],
                              "note": "Inverse: head %.2f below shoulders %.2f/%.2f; neckline %.2f, upside target ~%.2f." % (vH, vL, vR, neck, target)})
        if len(highs) >= 2:
            (iL, vL), (iR, vR) = highs[-2], highs[-1]
            seg = close[iL:iR]
            if len(seg) > 10:
                bottom = float(seg.min())
                depth = max(vL, vR) - bottom
                handle = close[iR:]
                if abs(vL - vR) / max(vL, vR) < 0.06 and depth / max(vL, vR) > 0.10 and len(handle) >= 3:
                    hpull = (vR - float(handle.min())) / vR
                    if 0 < hpull < 0.5 * depth / vR + 0.02 and close[-1] < vR:
                        cands.append({"pattern": "Cup & Handle", "direction": "bullish", "confidence": 0.3,
                                      "neckline": _ovr(vR), "target": _ovr(vR + depth),
                                      "dates": [dates[iL], dates[iR]],
                                      "note": "Rounded base ~%.0f%% deep, rims %.2f/%.2f; a breakout above %.2f projects ~%.2f." % (depth / max(vL, vR) * 100, vL, vR, vR, vR + depth)})

        cands.sort(key=lambda c: -(c.get("confidence") or 0))
        return cands[:4]
    except Exception:
        return []


def compute_pe_history(stock, hist):
    """Historical trailing P/E = price ÷ TTM EPS, to judge whether the stock is
    cheap or expensive vs its OWN multi-year range (a far better 'expensive?'
    signal than a single current multiple). EPS from reported quarterly actuals
    rolled to TTM, falling back to annual diluted EPS. Approximate by nature
    (EPS revisions, sparse history) — tagged with `method`; None if unusable."""
    try:
        close = hist["Close"].astype(float)
        if close.empty:
            return None

        def _naive(ts):
            ts = pd.Timestamp(ts)
            return ts.tz_localize(None) if ts.tzinfo else ts

        eps_idx, eps_val, method = [], [], None

        # 1) Reported quarterly EPS → rolling 4-quarter TTM
        try:
            ed = stock.get_earnings_dates(limit=28)
            if ed is not None and not ed.empty:
                col = next((c for c in ed.columns if "Reported" in c and "EPS" in c), None)
                if col:
                    s = ed[col].dropna().sort_index()
                    s = s[[_naive(i) <= _naive(close.index[-1]) for i in s.index]]
                    if len(s) >= 4:
                        ttm = s.rolling(4).sum().dropna()
                        eps_idx = [_naive(i) for i in ttm.index]
                        eps_val = [float(v) for v in ttm.values]
                        method = "ttm_reported_eps"
        except Exception as exc:
            logger.debug("pe_history: reported-EPS TTM path failed", exc_info=exc)

        # 2) Fallback: annual diluted/basic EPS
        if not eps_idx:
            try:
                fin = stock.income_stmt
                if fin is not None and not fin.empty:
                    row = next((r for r in ["Diluted EPS", "Basic EPS"] if r in fin.index), None)
                    if row:
                        s = fin.loc[row].dropna()
                        pairs = sorted(((_naive(i), float(v)) for i, v in s.items()), key=lambda p: p[0])
                        eps_idx = [p[0] for p in pairs]
                        eps_val = [p[1] for p in pairs]
                        method = "annual_eps"
            except Exception as exc:
                logger.debug("pe_history: annual-EPS fallback failed", exc_info=exc)

        if len(eps_idx) < 2:
            return None

        # Forward-fill the most recent known TTM EPS as-of each price date
        series, full_pe, cur, ei = [], [], None, 0
        for d, px in zip((_naive(i) for i in close.index), close.values):
            while ei < len(eps_idx) and eps_idx[ei] <= d:
                cur = eps_val[ei]
                ei += 1
            if cur and cur > 0:
                pe = float(px) / cur
                if 0 < pe < 1000:
                    full_pe.append(pe)
                    series.append({"date": d.strftime("%Y-%m-%d"), "pe": round(pe, 2)})

        if len(full_pe) < 20:
            return None

        arr = np.array(full_pe)
        current = float(arr[-1])
        pctile = float((arr < current).mean() * 100)
        step = max(1, len(series) // 260)
        ds = series[::step]
        if ds[-1]["date"] != series[-1]["date"]:
            ds.append(series[-1])
        verdict = ("cheap vs its own history" if pctile < 25
                   else "expensive vs its own history" if pctile > 75
                   else "in its normal historical range")
        return {
            "series": ds, "current": round(current, 2),
            "min": round(float(arr.min()), 2), "max": round(float(arr.max()), 2),
            "median": round(float(np.median(arr)), 2),
            "p25": round(float(np.percentile(arr, 25)), 2),
            "p75": round(float(np.percentile(arr, 75)), 2),
            "percentile": round(pctile, 1), "verdict": verdict,
            "method": method, "years": round(len(full_pe) / 252, 1),
        }
    except Exception:
        return None


def get_technicals(stock: yf.Ticker) -> dict:
    try:
        hist = stock.history(period="5y", interval="1d")
        if hist.empty:
            return {"error": "No price history"}

        close = hist["Close"]
        volume = hist["Volume"]

        # SMAs
        sma20 = close.rolling(20).mean()
        sma50 = close.rolling(50).mean()
        sma200 = close.rolling(200).mean()
        price = close.iloc[-1]

        # RSI
        delta = close.diff()
        gain = delta.clip(lower=0).rolling(14).mean()
        loss = (-delta.clip(upper=0)).rolling(14).mean()
        rs = gain / loss
        rsi = 100 - (100 / (1 + rs))
        rsi_val = round(float(rsi.iloc[-1]), 1)

        # MACD
        ema12 = close.ewm(span=12).mean()
        ema26 = close.ewm(span=26).mean()
        macd_line = ema12 - ema26
        signal_line = macd_line.ewm(span=9).mean()
        histogram = macd_line - signal_line
        macd_val = round(float(macd_line.iloc[-1]), 4)
        signal_val = round(float(signal_line.iloc[-1]), 4)
        hist_val = round(float(histogram.iloc[-1]), 4)

        # Bollinger Bands
        bb_mid = sma20
        bb_std = close.rolling(20).std()
        bb_upper = bb_mid + 2 * bb_std
        bb_lower = bb_mid - 2 * bb_std
        bb_width = round(float((bb_upper.iloc[-1] - bb_lower.iloc[-1]) / bb_mid.iloc[-1] * 100), 2)

        if price > bb_upper.iloc[-1]:
            bb_position = "Above upper band"
        elif price > bb_mid.iloc[-1] + (bb_upper.iloc[-1] - bb_mid.iloc[-1]) * 0.5:
            bb_position = "Near upper band"
        elif price < bb_lower.iloc[-1]:
            bb_position = "Below lower band"
        elif price < bb_mid.iloc[-1] - (bb_mid.iloc[-1] - bb_lower.iloc[-1]) * 0.5:
            bb_position = "Near lower band"
        else:
            bb_position = "Middle"

        # Volume analysis
        vol_20avg = float(volume.rolling(20).mean().iloc[-1])
        vol_5avg = float(volume.rolling(5).mean().iloc[-1])
        vol_current = float(volume.iloc[-1])

        # Support/Resistance (local minima/maxima over 90 days)
        recent = close.iloc[-90:]
        supports, resistances = [], []
        window = 10
        for i in range(window, len(recent) - window):
            segment = recent.iloc[i - window:i + window + 1]
            val = recent.iloc[i]
            if val == segment.min():
                supports.append(round(float(val), 2))
            if val == segment.max():
                resistances.append(round(float(val), 2))
        supports = sorted(set(supports))[-3:]
        resistances = sorted(set(resistances))[:3]

        # Price history for chart (last 252 days)
        # Return the full ~5y window so the chart can scroll/zoom out; SMAs are
        # computed over the whole series above, so they stay valid across it.
        CHART_BARS = 1300
        chart_data = []
        sma20_list = sma20.iloc[-CHART_BARS:].tolist()
        sma50_list = sma50.iloc[-CHART_BARS:].tolist()
        sma200_list = sma200.iloc[-CHART_BARS:].tolist()
        for i, (idx, row) in enumerate(hist.iloc[-CHART_BARS:].iterrows()):
            chart_data.append({
                "date": idx.strftime("%Y-%m-%d"),
                "open": round(float(row["Open"]), 2),
                "high": round(float(row["High"]), 2),
                "low": round(float(row["Low"]), 2),
                "close": round(float(row["Close"]), 2),
                "volume": int(row["Volume"]) if not pd.isna(row["Volume"]) else 0,
                "sma20": round(float(sma20_list[i]), 2) if not math.isnan(sma20_list[i]) else None,
                "sma50": round(float(sma50_list[i]), 2) if not math.isnan(sma50_list[i]) else None,
                "sma200": round(float(sma200_list[i]), 2) if not math.isnan(sma200_list[i]) else None,
            })

        sma20_val = float(sma20.iloc[-1])
        sma50_val = float(sma50.iloc[-1])
        sma200_val = float(sma200.iloc[-1]) if not math.isnan(float(sma200.iloc[-1])) else None

        return {
            "price": round(float(price), 2),
            "sma20": round(sma20_val, 2),
            "sma50": round(sma50_val, 2),
            "sma200": round(sma200_val, 2) if sma200_val else None,
            "price_vs_sma20": "above" if price > sma20_val else "below",
            "price_vs_sma50": "above" if price > sma50_val else "below",
            "price_vs_sma200": ("above" if sma200_val and price > sma200_val else "below") if sma200_val else None,
            "golden_cross": bool(sma50_val > sma200_val) if sma200_val else None,
            "rsi": rsi_val,
            "rsi_signal": "Overbought" if rsi_val > 70 else ("Oversold" if rsi_val < 30 else "Neutral"),
            "macd": macd_val,
            "macd_signal": signal_val,
            "macd_histogram": hist_val,
            "macd_trend": "Bullish" if macd_val > signal_val else "Bearish",
            "bb_upper": round(float(bb_upper.iloc[-1]), 2),
            "bb_middle": round(float(bb_mid.iloc[-1]), 2),
            "bb_lower": round(float(bb_lower.iloc[-1]), 2),
            "bb_position": bb_position,
            "bb_width": bb_width,
            "volume_current": int(vol_current) if not math.isnan(vol_current) else 0,
            "volume_20d_avg": int(vol_20avg) if not math.isnan(vol_20avg) else 0,
            "volume_ratio": round(vol_current / vol_20avg, 2) if (vol_20avg and not math.isnan(vol_20avg) and not math.isnan(vol_current)) else None,
            "volume_trend": "Increasing" if vol_5avg > vol_20avg else "Decreasing",
            "support_levels": supports,
            "resistance_levels": resistances,
            "chart_data": chart_data,
            # --- Overlay geometry + valuation (Phases 1–3) ---
            "fib": compute_fibonacci(hist),
            "psych_levels": compute_psych_levels(price),
            "regression_channel": compute_regression_channel(hist),
            "candle_patterns": compute_candle_patterns(hist),
            "chart_patterns": compute_chart_patterns(hist),
            "pe_history": compute_pe_history(stock, hist),
        }
    except Exception as e:
        return {"error": str(e)}
