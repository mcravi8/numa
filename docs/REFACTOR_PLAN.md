# Numa — GitHub + Refactor Plan (Claude Code playbook)

Goal: publish the current two-file version first, then split `main.py` into a professional package over a series of small commits, so the repo history shows real work over time.

Rule for every step: **one concern per commit, app must run after every commit** (`uvicorn` boots, `/analyze/AAPL` returns data). Never mix a refactor commit with a behavior change.

---

## Step 0 — Create the repo and push v0 (you, in terminal — 5 minutes)

```bash
cd <your numa folder>          # the folder containing main.py, index.html, .gitignore, README.md
git init
git add .
git commit -m "Initial version: monolithic FastAPI backend + SPA frontend"
gh repo create numa --public --source=. --push
```

`.gitignore` already excludes `.env` (keys) and `notes.json` (personal data). Verify before pushing: `git status` must not list either.

---

## Target structure (where the refactor ends up)

```
numa/
├── run.py                     # uvicorn entrypoint
├── app/
│   ├── __init__.py            # create_app() factory: CORS, routers, static
│   ├── config.py              # env loading, API keys, shared clients, constants
│   ├── utils.py               # _json_safe, _ovr, shared small helpers
│   ├── routes/
│   │   ├── frontend.py        # /, manifest, sw.js, icons
│   │   ├── analyze.py         # /analyze/{ticker}, /analyze/stream/{ticker}
│   │   ├── quotes.py          # /quote/{ticker}, /quotes
│   │   ├── notes.py           # /notes GET/POST
│   │   ├── ai.py              # /synthesize, /numa
│   │   ├── macro.py           # /macro
│   │   └── search.py          # /search, /health
│   └── modules/               # one file per data module (the module-pattern.md nine + friends)
│       ├── company.py  quote.py  financials.py  technicals.py
│       ├── options.py  insider.py  news.py  peers.py
│       ├── earnings.py  ratings.py  congress.py
│       └── premium_demo.py    # dark pool / GEX / options-flow demo generators
├── static/                    # index.html, manifest.json, sw.js, icon.svg, generate_icons.py
├── docs/                      # module-pattern.md, this file
├── tests/
├── requirements.txt  start.sh  stop.sh  README.md  .env.example  .gitignore
```

Rationale: `routes/` vs `modules/` mirrors the existing fetcher/transformer discipline in `module-pattern.md` — endpoints orchestrate, modules produce `dict`s. `config.py` fixes the current inconsistency where the Anthropic client is a startup global but the Finnhub key is re-read on every call.

---

## Commit sequence — one Claude Code prompt per session

Run these in order, each as its own Claude Code session in the repo root. Each ends with a commit.

### Prompt 1 — repo hygiene (no code moves)

> Read main.py and module-pattern.md to understand this project. Do not restructure anything yet. Tasks: (1) create run.py that launches uvicorn for main:app on port 8000 and update start.sh to use it; (2) pin all versions in requirements.txt to the currently installed ones; (3) add a CLAUDE.md at repo root summarizing: project purpose, the two-file layout, the module pattern rules from module-pattern.md, and the standing rule that every commit must leave `uvicorn main:app` bootable and /analyze/AAPL working. Verify the server boots. Commit as "chore: entrypoint, pinned deps, CLAUDE.md".

### Prompt 2 — smoke tests BEFORE refactoring

> Add pytest and httpx as dev dependencies. Create tests/test_smoke.py using FastAPI's TestClient against the app in main.py: /health returns ok; / returns HTML; /analyze/AAPL returns 200 with keys ticker, quote, financials, technicals and error == None; /quote/AAPL returns a price; /notes GET returns a list. Mark network-dependent tests so they can be skipped offline. Run the tests, make them pass. Commit as "test: smoke tests for core endpoints".

These tests are the safety net for every step below — each later prompt reruns them.

### Prompt 3 — extract config and utils

> Create the app/ package. Move into app/config.py: load_dotenv, all os.getenv key reads, SEC_HEADERS, ANTHROPIC_CLIENT, QUIVER_* constants, BASE_DIR, NOTES_FILE. Standardize: every API key is read once in config.py (fix the Finnhub per-call getenv pattern — build one shared Finnhub client or None if no key). Move _json_safe and _ovr into app/utils.py. main.py imports from these; behavior identical. Run tests. Commit as "refactor: extract config and shared utils".

### Prompt 4 — extract the data modules

> Following module-pattern.md, move each per-ticker data function from main.py into its own file under app/modules/ (company, quote, financials, technicals, options, insider, news, peers, earnings, ratings, congress, premium_demo). Keep each module's file-level helpers (compute_*, _find_pivots, _ai_news_sentiment, etc.) with their owner. Modules import keys/clients from app.config, helpers from app.utils. main.py becomes an importer + endpoint file. Also apply module-pattern.md's "Rules for a new module" where cheap: fetchers get 10s timeouts. No other behavior changes. Run tests. Commit as "refactor: split data modules into app/modules".

### Prompt 5 — extract the routes, app factory

> Split main.py's endpoints into APIRouter files under app/routes/ as laid out in docs/REFACTOR_PLAN.md (frontend, analyze, quotes, notes, ai, macro, search). Create create_app() in app/__init__.py: FastAPI instance, CORS, router registration, static mounts — route order preserved (catch-all static mount last). Reduce main.py to `from app import create_app; app = create_app()` for backward compatibility. Move index.html, manifest.json, sw.js, icon.svg, generate_icons.py into static/ and update paths. Run tests, verify PWA still loads at /. Commit as "refactor: routers + app factory, static/ directory".

### Prompt 6 — shared analysis pipeline

> analyze() and analyze_stream() duplicate the module-dispatch list. Create one ordered registry in app/routes/analyze.py — a list of (key, label, callable) — consumed by both endpoints so a new module is registered in exactly one place. Preserve current output shapes exactly. Run tests. Commit as "refactor: single module registry for analyze endpoints".

### Prompt 7 — polish pass

> Quality pass, no behavior changes: type hints on all module signatures; module docstrings; replace bare `except Exception: pass` with logging via a configured logger where silent failure hides real errors; add ruff config and fix what it flags; update README.md's "Current state" section to describe the new structure with a small tree. Run tests and ruff. Commit as "chore: typing, logging, lint, README".

### Later, independent commits (natural history for the repo)

- CORS tightened to localhost origins; notes.json path configurable
- Frontend split (index.html is ~320KB: extract css/ and js/ from it) — its own multi-commit track
- GitHub Actions: ruff + pytest on push
- Per-module unit tests with recorded fixtures instead of live yfinance
- Activate a premium module live (each activation = one meaningful commit)

---

## Working rhythm

One prompt = one session = one commit, pushed immediately (`git push`). Do not batch prompts 3–5 into a single session; separate commits are the point — the history is the report.
