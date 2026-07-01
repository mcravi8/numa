"""Shared JSON-safety helpers: coerce numpy scalars and NaN/Inf to JSON-native
types so the strict (allow_nan=False) responses never 500.
"""
# ============================================================
# === UTILS — shared JSON-safety helpers ===
# ============================================================
# The non-streaming endpoints render with strict ``allow_nan=False`` and
# yfinance leaks numpy scalars / NaN. These two helpers coerce payloads to
# JSON-native types so those responses never 500.

import math

import numpy as np


def _json_safe(obj):
    """Recursively coerce a payload to JSON-native types: numpy scalars → python
    scalars, NaN/Inf → None. yfinance leaks np.float64 / np.bool_ (e.g.
    earnings.beat = np.True_, financials margins) which otherwise 500 the strict
    (allow_nan=False) JSONResponse on this non-streaming endpoint. Same family as
    the macro layer's _macro_clean, generalized to numpy types."""
    if isinstance(obj, dict):
        return {k: _json_safe(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_json_safe(v) for v in obj]
    if isinstance(obj, np.bool_):
        return bool(obj)
    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, np.floating):
        obj = float(obj)
    if isinstance(obj, float):
        return None if (math.isnan(obj) or math.isinf(obj)) else obj
    return obj


def _ovr(x):
    try:
        x = float(x)
        return None if (math.isnan(x) or math.isinf(x)) else round(x, 2)
    except Exception:
        return None
