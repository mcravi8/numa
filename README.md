# Numa — Personal 360° Stock Research Terminal

[![CI](https://github.com/mcravi8/numa/actions/workflows/ci.yml/badge.svg)](https://github.com/mcravi8/numa/actions/workflows/ci.yml)

A self-hosted stock analysis terminal: FastAPI backend + single-page PWA frontend, with an AI analyst ("Numa") powered by Claude.

For any ticker it assembles a 360° view — quote, financials, technicals (SMA/RSI/MACD/Bollinger, Fibonacci, regression channel, candle & chart patterns, historical P/E), options flow with unusual-contract detection and max pain, SEC insider filings, news sentiment, peer comparison, earnings history, analyst ratings, congressional trades (Quiver), and a macro dashboard — then streams it to the browser over SSE and lets Numa synthesize and chat about it.

## Current state

The backend has been refactored from a single `main.py` into an `app/` package.
`main.py` is now a thin entrypoint (`from app import create_app; app = create_app()`)
so `uvicorn main:app` still works. The frontend/PWA assets live in `static/`.

```
.
├── main.py                 # entrypoint shim → app.create_app()
├── run.py                  # uvicorn launcher
├── app/
│   ├── __init__.py         # create_app(): CORS, routers, /static mount
│   ├── config.py           # env, API keys, shared clients, paths, logger
│   ├── utils.py            # _json_safe / _ovr JSON-safety helpers
│   ├── routes/             # one APIRouter per concern
│   │   ├── frontend.py     #   /, manifest, sw.js, icons
│   │   ├── analyze.py      #   /analyze/{ticker}, /analyze/stream/{ticker}
│   │   ├── quotes.py       #   /quote/{ticker}, /quotes
│   │   ├── notes.py        #   /notes
│   │   ├── ai.py           #   /synthesize, /numa
│   │   ├── macro.py        #   /macro (+ FRED helpers)
│   │   └── search.py       #   /search, /health
│   └── modules/            # one file per per-ticker data module
│       ├── company.py  quote.py  financials.py  technicals.py
│       ├── options.py  insider.py  news.py  peers.py
│       ├── earnings.py  ratings.py  congress.py
│       └── premium_demo.py #   dark-pool / GEX / options-flow demo data
├── static/                 # index.html, manifest.json, sw.js, icons, generate_icons.py
├── docs/                   # module-pattern.md, REFACTOR_PLAN.md, NIGHT_RUN_REPORT.md
└── tests/                  # pytest smoke suite
```

Both `/analyze/{ticker}` and its streaming variant are driven by a single ordered
module registry in `app/routes/analyze.py`, so a new data module is registered in
exactly one place. Lint config lives in `ruff.toml`; run `ruff check .`.

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
