"""Insider-activity module: recent SEC Form 4 transactions for a ticker.

Fetcher — pulls the CIK and Form 4 filings from SEC EDGAR itself with explicit
timeouts (see docs/module-pattern.md).
"""
# ============================================================
# === MODULE 6: INSIDER ACTIVITY ===
# ============================================================

from datetime import datetime, timedelta

import requests

from app.config import SEC_HEADERS


def get_insider_activity(ticker: str) -> dict:
    try:
        # Get CIK
        cik_data = requests.get(
            "https://www.sec.gov/files/company_tickers.json",
            headers=SEC_HEADERS, timeout=10
        ).json()
        cik = None
        for v in cik_data.values():
            if v.get("ticker", "").upper() == ticker.upper():
                cik = v["cik_str"]
                break
        if not cik:
            return {"error": "CIK not found for ticker"}

        cik_padded = str(cik).zfill(10)
        sub = requests.get(
            f"https://data.sec.gov/submissions/CIK{cik_padded}.json",
            headers=SEC_HEADERS, timeout=10
        ).json()

        filings = sub.get("filings", {}).get("recent", {})
        forms = filings.get("form", [])
        dates = filings.get("filingDate", [])
        accessions = filings.get("accessionNumber", [])
        descriptions = filings.get("primaryDocument", [])

        transactions = []
        form4_indices = [i for i, f in enumerate(forms) if f == "4"][:30]

        tx_codes = {"P": "Purchase", "S": "Sale", "A": "Award/Grant", "F": "Tax Withholding",
                    "M": "Option Exercise", "G": "Gift", "D": "Disposition"}

        import re as _re
        for i in form4_indices:
            try:
                acc = accessions[i].replace("-", "")
                doc_raw = descriptions[i]
                # Strip the XSL stylesheet prefix to get raw XML path
                xml_filename = doc_raw.replace("xslF345X06/", "").replace("xslF345X05/", "").replace("xslF345X04/", "")
                xml_url = f"https://www.sec.gov/Archives/edgar/data/{cik}/{acc}/{xml_filename}"
                r = requests.get(xml_url, headers=SEC_HEADERS, timeout=8)
                if r.status_code != 200:
                    continue
                content = r.text

                name_match = _re.search(r"<rptOwnerName>(.*?)</rptOwnerName>", content, _re.DOTALL)
                title_match = _re.search(r"<officerTitle>(.*?)</officerTitle>", content, _re.DOTALL)
                code_match = _re.search(r"<transactionCode>(.*?)</transactionCode>", content, _re.DOTALL)
                shares_match = _re.search(r"<transactionShares>.*?<value>([\d.]+)</value>", content, _re.DOTALL)
                price_match = _re.search(r"<transactionPricePerShare>.*?<value>([\d.]+)</value>", content, _re.DOTALL)
                post_match = _re.search(r"<sharesOwnedFollowingTransaction>.*?<value>([\d.]+)</value>", content, _re.DOTALL)

                if not name_match or not code_match:
                    continue

                code = code_match.group(1).strip()
                shares = float(shares_match.group(1)) if shares_match else 0
                price = float(price_match.group(1)) if price_match else 0
                post = float(post_match.group(1)) if post_match else 0

                transactions.append({
                    "insider_name": name_match.group(1).strip(),
                    "title": title_match.group(1).strip() if title_match else "Director/Officer",
                    "transaction_date": dates[i],
                    "transaction_type": code,
                    "transaction_type_label": tx_codes.get(code, code),
                    "shares": int(shares),
                    "price_per_share": round(price, 2),
                    "total_value": int(shares * price),
                    "shares_owned_after": int(post),
                })
            except Exception:
                continue

        now = datetime.now()
        d30 = (now - timedelta(days=30)).strftime("%Y-%m-%d")
        d90 = (now - timedelta(days=90)).strftime("%Y-%m-%d")

        purchases_30d = [t for t in transactions if t["transaction_date"] >= d30 and t["transaction_type"] == "P"]
        sales_30d = [t for t in transactions if t["transaction_date"] >= d30 and t["transaction_type"] == "S"]
        purchases_90d = [t for t in transactions if t["transaction_date"] >= d90 and t["transaction_type"] == "P"]
        sales_90d = [t for t in transactions if t["transaction_date"] >= d90 and t["transaction_type"] == "S"]

        net_buying_30d = sum(t["total_value"] for t in purchases_30d) - sum(t["total_value"] for t in sales_30d)
        buy_count_90d = len(purchases_90d)
        sell_count_90d = len(sales_90d)

        ceo_activity = [t for t in transactions if "CEO" in t.get("title", "").upper() and t["transaction_date"] >= d90]

        biggest = max(transactions, key=lambda x: x["total_value"]) if transactions else None

        return {
            "transactions": transactions[:20],
            "net_buying_30d": net_buying_30d,
            "buy_count_90d": buy_count_90d,
            "sell_count_90d": sell_count_90d,
            "buy_sell_ratio_90d": round(buy_count_90d / sell_count_90d, 2) if sell_count_90d else None,
            "largest_single_transaction": biggest,
            "ceo_activity": ceo_activity[:3],
            "sentiment": "Bullish" if net_buying_30d > 0 else ("Bearish" if net_buying_30d < 0 else "Neutral"),
        }
    except Exception as e:
        return {"error": str(e)}
