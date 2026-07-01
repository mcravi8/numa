# CLAUDE.md — Research Terminal ("Numa")

Guidance for Claude Code (and humans) working in this repo. Read this first.

## Project purpose

Numa is a self-hosted, personal **360° stock research terminal**: a FastAPI
backend plus a single-page PWA frontend, with an AI analyst ("Numa") powered by
Claude. For any ticker it assembles quote, financials, technicals (SMA/RSI/MACD/
Bollinger, Fibonacci, regression channel, candle & chart patterns, historical
P/E), options flow (unusual-contract detection, max pain), SEC insider filings,
news sentiment, peer comparison, earnings history, analyst ratings, and
congressional trades — plus a macro dashboard — streams it to the browser over
Server-Sent Events, and lets Numa synthesize and chat about it. Premium modules
(dark pool, gamma exposure, real-time quotes, live congress/options flow) return
demo data until the corresponding API keys are supplied.

It is a personal research tool. Nothing it produces is financial advice.

## The standing rule (do not break this)

**Every commit must leave the app bootable and working:**

- `uvicorn main:app` (equivalently `python run.py`) must start with no errors.
- `GET /analyze/AAPL` must return HTTP 200 with a populated payload and
  `error == None`.

One concern per commit; never mix a refactor with a behavior change. Verify boot
+ `/analyze/AAPL` before every commit. This is the invariant the incremental
refactor (see `docs/REFACTOR_PLAN.md`) is built around.

## Two-file layout

The project is intentionally **two main files** right now (a package refactor is
planned but not yet done — see `docs/REFACTOR_PLAN.md`):

- **`main.py`** — the entire backend: FastAPI app, every data module, the AI
  endpoints, macro, and search. ~2.7k lines.
- **`index.html`** — the entire frontend: SPA, charting, and the Numa chat UI.
  ~3.6k lines.

Supporting files: `run.py` (uvicorn entrypoint), `start.sh` / `stop.sh` (manage
a background instance), `requirements.txt` (pinned), `manifest.json` + `sw.js` +
`icon*.png` (PWA assets), `.env` (keys, git-ignored), `notes.json` (saved AI
output, git-ignored), `module-pattern.md` and `docs/REFACTOR_PLAN.md` (docs).

## Running it

```bash
pip install -r requirements.txt      # use the python3.11 runtime (see below)
cp .env.example .env                 # fill in keys; ANTHROPIC_API_KEY for AI
python run.py                        # → http://localhost:8000
# or, for dev auto-reload:
RELOAD=1 python run.py               # == uvicorn main:app --reload --port 8000
# or, background instance (Login Items):
./start.sh   /   ./stop.sh
```

**Interpreter note:** on this machine the default `python3` is 3.13 and lacks
the deps; the runtime lives on Homebrew **python3.11**. `start.sh` auto-selects
it (via the installed `uvicorn` script's shebang, then `python3.11`). Run manual
commands with that interpreter too.

## Endpoints (all in `main.py`)

- Frontend/PWA: `GET /`, `/manifest.json`, `/sw.js`, `/icon-192.png`, `/icon-512.png`
- Analysis: `GET /analyze/{ticker}` (full JSON), `GET /analyze/stream/{ticker}` (SSE)
- Quotes: `GET /quote/{ticker}` (live single), `GET /quotes` (batch watchlist)
- Notes: `GET /notes`, `POST /notes` (frontend pushes the full array)
- AI: `POST /synthesize`, `POST /numa`
- Other: `GET /macro`, `GET /search`, `GET /health`

`?mode=premium` on the analyze endpoints turns on the demo premium modules.

## Data sources & keys

| Source | Key | Used for |
|---|---|---|
| yfinance | none | quotes, financials, technicals, options, earnings, ratings |
| SEC EDGAR | none (User-Agent header) | insider filings |
| Finnhub | free | news, peers (fall back to yfinance / hard-coded list) |
| Anthropic / Claude | required for AI | Numa chat, synthesis, news-sentiment scoring |
| Quiver Quantitative | premium | live congressional trades |
| Unusual Whales / Polygon | premium | options flow, dark pool, GEX, real-time quotes (demo without keys) |

Keys load from `.env` via `load_dotenv()` at startup, read with `os.getenv(...)`.

## Module pattern (see `module-pattern.md` for the full write-up)

The per-ticker data capabilities are each implemented as a sibling function
under a `# === MODULE N: NAME ===` banner. The **skeleton every module shares**:

1. A single **top-level function** under a `MODULE N` banner.
2. Named **`get_<noun>`** (snake_case); dropping `get_` gives the result key
   (`get_options_flow` → `result["options_flow"]`).
3. Type-hinted to **return a `dict`**.
4. The dict has one of two shapes: **success** (a flat bag of labelled values)
   or **failure** `{"error": "<what went wrong>"}`.
5. The whole body is wrapped in **one outer safety net**:
   `try: ... return {...} except Exception as e: return {"error": str(e)}`.
6. Dispatched **sequentially, one at a time** (never in parallel) from the two
   endpoints `analyze()` and `analyze_stream()` — which fetch the base
   `yf.Ticker(...)` / `.info` **once** and hand it down.

### Rules for a NEW module (these override the places the existing nine disagree)

1. **Fetcher vs. transformer.** A *fetcher* gets its own data from an external
   service: it takes the bare `ticker` string, puts an explicit **10-second
   timeout** on the call, and reads its API key from a **named constant declared
   once near the top of the file** (not re-read mid-function). A *transformer*
   does no fetching — it reshapes the `stock`/`info` objects the endpoint already
   fetched and sets **no timeout**. Deciding test: does it make its own external
   call? Fetcher. Only reshapes given data? Transformer.
2. **Finding nothing is success, not an error.** Return the normal dict shape
   with the relevant list empty plus a short human-readable note. Reserve
   `{"error": ...}` for genuine failures (API unreachable, bad/missing key,
   crash).
3. **Dispatch order does not matter.** Add the new module to the end of both
   `analyze()` and `analyze_stream()`; position relative to others is irrelevant.
4. **Internal structure is up to you.** Use helper functions or a single flat
   block — whatever the logic calls for; this is deliberately not standardized.

Helper naming conventions in the file: `compute_*` for deterministic technical
math, a leading underscore (`_ovr`, `_find_pivots`, `_ai_news_sentiment`) for
private helpers, and `get_*_demo` for premium/demo data generators.

## JSON safety

The non-streaming endpoints render with strict `allow_nan=False`, and yfinance
leaks numpy scalars / NaN. `_json_safe()` recursively coerces payloads to
JSON-native types (numpy → python, NaN/Inf → `None`); `_ovr()` does the same for
single rounded floats. Route new numeric output through them.

## Refactor context

This repo is being incrementally refactored from the two-file layout into an
`app/` package, one small commit at a time, so the git history reads as real
work. The plan, target structure, and per-step prompts are in
`docs/REFACTOR_PLAN.md`. **Do not restructure ahead of that plan** unless asked;
keep honoring the standing rule above at every step.
