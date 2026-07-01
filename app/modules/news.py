# ============================================================
# === MODULE 7: NEWS & SENTIMENT ===
# ============================================================

import json
import yfinance as yf
from datetime import datetime, timedelta

from app.config import (
    ANTHROPIC_CLIENT,
    FINNHUB_CLIENT,
)


def _ai_news_sentiment(ticker: str, articles: list) -> dict:
    """Score headlines with Claude when no pre-computed sentiment is available.

    Finnhub's news_sentiment endpoint is premium-only, so on the free tier it
    silently fails and the sentiment panel is blank. Instead we send the
    headlines we already have to Claude and ask it to judge how each one moves
    the bull/bear thesis. Returns the same shape the UI's sentiment panel reads,
    plus a one-line bull_case / bear_case and a per-article label.

    Mutates each article's "sentiment" in place. Returns {} on any failure so
    the caller degrades gracefully (panel shows "—", exactly as before).
    """
    if not ANTHROPIC_CLIENT.api_key or not articles:
        return {}
    headlines = articles[:15]
    listing = "\n".join(
        f'{i}. {a.get("headline","")} ({a.get("source","")})'
        for i, a in enumerate(headlines)
    )
    schema = (
        '{"score":<number -1..1 overall, weighted by materiality & recency>,'
        '"label":"<Very Bullish|Bullish|Neutral|Bearish|Very Bearish>",'
        '"bull_case":"<=160 chars, what the bulls take from this news>",'
        '"bear_case":"<=160 chars, what the bears take from this news>",'
        '"articles":[{"i":<int>,"s":"<Bullish|Bearish|Neutral>"}]}'
    )
    system = (
        "You are an equity analyst classifying news sentiment for a single stock. "
        "Judge how each headline affects the bull/bear thesis for the given ticker, "
        "not whether it is generically positive. Reflect genuine disagreement: a "
        "mixed news flow should produce a near-zero score with both a real bull and "
        "bear case. Respond with ONLY minified JSON, no prose, no code fences."
    )
    user_msg = (
        f"Ticker: {ticker}\nHeadlines:\n{listing}\n\n"
        f"Return JSON exactly matching this schema:\n{schema}"
    )
    try:
        resp = ANTHROPIC_CLIENT.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=700,
            system=system,
            messages=[{"role": "user", "content": user_msg}],
        )
        raw = resp.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1].lstrip("json").strip()
        parsed = json.loads(raw)
    except Exception:
        return {}

    for item in parsed.get("articles", []):
        idx = item.get("i")
        if isinstance(idx, int) and 0 <= idx < len(headlines):
            headlines[idx]["sentiment"] = item.get("s")

    try:
        score = round(max(-1.0, min(1.0, float(parsed.get("score", 0.0)))), 3)
    except (TypeError, ValueError):
        score = 0.0
    label = parsed.get("label") or (
        "Very Bullish" if score > 0.3 else
        "Bullish" if score > 0.1 else
        "Very Bearish" if score < -0.3 else
        "Bearish" if score < -0.1 else "Neutral"
    )
    return {
        "score": score,
        "bullish_pct": round((score + 1) / 2, 3),
        "bearish_pct": round((1 - score) / 2, 3),
        "label": label,
        "bull_case": parsed.get("bull_case", ""),
        "bear_case": parsed.get("bear_case", ""),
        "source": "Claude",
    }


def get_news_sentiment(ticker: str) -> dict:
    try:
        articles = []
        sentiment_data = {}
        buzz = None

        if FINNHUB_CLIENT:
            from_date = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")
            to_date = datetime.now().strftime("%Y-%m-%d")
            try:
                news = FINNHUB_CLIENT.company_news(ticker, _from=from_date, to=to_date)
                for a in (news or [])[:15]:
                    articles.append({
                        "headline": a.get("headline", ""),
                        "source": a.get("source", ""),
                        "datetime": datetime.fromtimestamp(a.get("datetime", 0)).strftime("%Y-%m-%d %H:%M"),
                        "url": a.get("url", ""),
                        "sentiment": None,
                    })
            except Exception:
                pass
            try:
                s = FINNHUB_CLIENT.news_sentiment(ticker)
                buzz = s.get("buzz", {}).get("buzz")
                bullish = s.get("sentiment", {}).get("bullishPercent", 0.5)
                bearish = s.get("sentiment", {}).get("bearishPercent", 0.5)
                score = round(bullish - bearish, 3)
                sentiment_data = {
                    "score": score,
                    "bullish_pct": bullish,
                    "bearish_pct": bearish,
                    "label": (
                        "Very Bullish" if score > 0.3 else
                        "Bullish" if score > 0.1 else
                        "Bearish" if score < -0.1 else
                        "Very Bearish" if score < -0.3 else "Neutral"
                    ),
                }
            except Exception:
                pass

        # Fallback: yfinance news
        if not articles:
            stock = yf.Ticker(ticker)
            yf_news = stock.news or []
            for a in yf_news[:10]:
                ct = a.get("content", {})
                articles.append({
                    "headline": ct.get("title", a.get("title", "")),
                    "source": ct.get("provider", {}).get("displayName", ""),
                    "datetime": datetime.fromtimestamp(
                        a.get("providerPublishTime", 0) or
                        (ct.get("pubDate", "") and 0) or 0
                    ).strftime("%Y-%m-%d %H:%M") if a.get("providerPublishTime") else "",
                    "url": ct.get("canonicalUrl", {}).get("url", a.get("link", "")),
                    "sentiment": None,
                })

        # Finnhub's news_sentiment is premium-gated, so on the free tier
        # sentiment_data is empty here. Fall back to Claude scoring the
        # headlines we already have (free-tier friendly, and richer: it
        # produces per-article labels plus a bull/bear case).
        if not sentiment_data.get("score") and articles:
            ai = _ai_news_sentiment(ticker, articles)
            if ai:
                sentiment_data = ai

        one_week_ago = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
        articles_this_week = sum(1 for a in articles if a.get("datetime", "") >= one_week_ago)

        return {
            "articles": articles,
            "articles_count": len(articles),
            "articles_this_week": articles_this_week,
            "buzz_score": buzz,
            "sentiment": sentiment_data,
        }
    except Exception as e:
        return {"error": str(e)}
