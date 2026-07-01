# Numa — Personal 360° Stock Research Terminal

A self-hosted stock analysis terminal: FastAPI backend + single-page PWA frontend, with an AI analyst ("Numa") powered by Claude.

For any ticker it assembles a 360° view — quote, financials, technicals (SMA/RSI/MACD/Bollinger, Fibonacci, regression channel, candle & chart patterns, historical P/E), options flow with unusual-contract detection and max pain, SEC insider filings, news sentiment, peer comparison, earnings history, analyst ratings, congressional trades (Quiver), and a macro dashboard — then streams it to the browser over SSE and lets Numa synthesize and chat about it.

## Current state

The project is intentionally two main files right now:

- `main.py` — the entire backend (FastAPI app, all data modules, AI endpoints)
- `index.html` — the entire frontend (SPA + charting + Numa chat UI)

It is being incrementally refactored into a proper package structure; watch the commit history.

## Quick start

```bash
pip install -r requirements.txt
cp .env.example .env   # fill in keys; only ANTHROPIC_API_KEY needed for AI features
uvicorn main:app --reload --port 8000
```

Open http://localhost:8000. Install as a PWA from Chrome's address bar if you want it in the dock (`./start.sh` / `./stop.sh` manage a background instance).

## Data sources

| Source | Key | Used for |
|---|---|---|
| yfinance | none | quotes, financials, technicals, options, earnings, ratings |
| SEC EDGAR | none | insider filings |
| Finnhub | free | news, peers (falls back to yfinance) |
| Anthropic | required for AI | Numa chat, synthesis, news sentiment scoring |
| Quiver Quantitative | premium | live congressional trades |
| Unusual Whales / Polygon | premium | options flow, dark pool, GEX, real-time quotes (demo data without keys) |

## Architecture notes

`docs/module-pattern.md` documents the shared skeleton of the per-ticker data modules and the rules new modules must follow.

## Disclaimer

Personal research tool. Nothing here is financial advice.
