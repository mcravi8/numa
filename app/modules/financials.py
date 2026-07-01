# ============================================================
# === MODULE 3: FINANCIALS ===
# ============================================================

import pandas as pd


def get_financials(stock, info: dict) -> dict:
    try:
        income = stock.income_stmt
        balance = stock.balance_sheet
        cashflow = stock.cashflow

        def safe_row(df, candidates):
            for c in candidates:
                if c in df.index:
                    return df.loc[c]
            return pd.Series(dtype=float)

        def to_list(series):
            return [
                {"period": str(col.year), "value": (None if pd.isna(v) else int(v))}
                for col, v in series.items()
            ][:3]

        def pct_change(series):
            vals = [v for v in series.values if not pd.isna(v)]
            result = []
            for i in range(len(vals) - 1):
                if vals[i + 1] and vals[i + 1] != 0:
                    result.append(round((vals[i] - vals[i + 1]) / abs(vals[i + 1]) * 100, 1))
                else:
                    result.append(None)
            return result

        rev = safe_row(income, ["Total Revenue", "Revenue"])
        gp = safe_row(income, ["Gross Profit"])
        op = safe_row(income, ["Operating Income", "EBIT"])
        ni = safe_row(income, ["Net Income", "Net Income Common Stockholders"])
        ebitda = safe_row(income, ["EBITDA", "Normalized EBITDA"])

        cash = safe_row(balance, ["Cash And Cash Equivalents", "Cash Cash Equivalents And Short Term Investments"])
        debt = safe_row(balance, ["Total Debt", "Long Term Debt"])
        assets = safe_row(balance, ["Total Assets"])
        equity = safe_row(balance, ["Stockholders Equity", "Common Stock Equity"])

        rev_vals = rev.dropna()
        gp_vals = gp.dropna()

        margins = []
        for col in rev.index[:3]:
            r = rev.get(col)
            g = gp.get(col)
            o = op.get(col)
            n = ni.get(col)
            if r and r != 0:
                margins.append({
                    "period": str(col.year),
                    "gross_margin": round(g / r * 100, 1) if g and not pd.isna(g) else None,
                    "operating_margin": round(o / r * 100, 1) if o and not pd.isna(o) else None,
                    "net_margin": round(n / r * 100, 1) if n and not pd.isna(n) else None,
                })

        total_debt_val = debt.iloc[0] if not debt.empty and not pd.isna(debt.iloc[0]) else 0
        cash_val = cash.iloc[0] if not cash.empty and not pd.isna(cash.iloc[0]) else 0
        equity_val = equity.iloc[0] if not equity.empty and not pd.isna(equity.iloc[0]) else 1

        return {
            "revenue": to_list(rev),
            "gross_profit": to_list(gp),
            "operating_income": to_list(op),
            "net_income": to_list(ni),
            "ebitda": to_list(ebitda),
            "revenue_growth_yoy": pct_change(rev),
            "margins": margins,
            "eps_ttm": info.get("trailingEps"),
            "eps_forward": info.get("forwardEps"),
            "cash": int(cash_val) if cash_val else None,
            "total_debt": int(total_debt_val) if total_debt_val else None,
            "net_debt": int(total_debt_val - cash_val) if total_debt_val else None,
            "total_assets": int(assets.iloc[0]) if not assets.empty and not pd.isna(assets.iloc[0]) else None,
            "debt_to_equity": round(total_debt_val / equity_val, 2) if equity_val else None,
            "pe_trailing": info.get("trailingPE"),
            "pe_forward": info.get("forwardPE"),
            "ps_ratio": info.get("priceToSalesTrailing12Months"),
            "pb_ratio": info.get("priceToBook"),
            "ev_ebitda": info.get("enterpriseToEbitda"),
            "ev_revenue": info.get("enterpriseToRevenue"),
            "peg_ratio": info.get("pegRatio"),
        }
    except Exception as e:
        return {"error": str(e)}
