"""Company profile module: name, sector, description, HQ, CEO from ``info``.

Transformer over the caller's pre-fetched ``info`` bag (see docs/module-pattern.md).
"""
# ============================================================
# === MODULE 1: COMPANY PROFILE ===
# ============================================================


def get_company(info: dict) -> dict:
    try:
        officers = info.get("companyOfficers", [])
        ceo = next(
            (o.get("name") for o in officers if "CEO" in o.get("title", "").upper()),
            officers[0].get("name") if officers else "N/A"
        )
        desc = info.get("longBusinessSummary", "")
        return {
            "name": info.get("longName", "N/A"),
            "sector": info.get("sector", "N/A"),
            "industry": info.get("industry", "N/A"),
            "description": desc[:600] + "..." if len(desc) > 600 else desc,
            "employees": info.get("fullTimeEmployees"),
            "headquarters": ", ".join(filter(None, [
                info.get("city"), info.get("state"), info.get("country")
            ])),
            "ceo": ceo,
            "website": info.get("website", ""),
            "exchange": info.get("exchange", ""),
            "currency": info.get("currency", "USD"),
        }
    except Exception as e:
        return {"error": str(e)}
