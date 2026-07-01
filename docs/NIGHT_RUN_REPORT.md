# Night Run Report — Refactor Prompts 5–7

Self-evaluation of the three-phase refactor executed as three commits (Prompts
5, 6, 7 of `docs/REFACTOR_PLAN.md`). Written to be honest, not flattering; where
something is only partially verified it says so.

Baselines were captured **before** Phase A, from the last green commit
`e06e7fc` ("refactor: split data modules into app/modules"), into `/tmp`:
`/openapi.json`, the bytes of `/`, and the full `/analyze/AAPL?mode=premium`
payload (plus a type-only structure skeleton). All diffs below are against those.

Runtime: Homebrew **python3.11** (3.11.13), as required by CLAUDE.md. Network was
up for the whole run, so the network-marked tests actually executed (5/5, not 3/5
+ 2 skipped).

---

## 1. Commits produced tonight

Three commits, in order, each its own concern. Nothing was pushed.

| # | SHA | Subject | Files | Lines |
|---|-----|---------|-------|-------|
| A | `9c55773` | refactor: routers + app factory, static/ directory | 21 | +1187 / −1125 |
| B | `3fbd358` | refactor: single module registry for analyze endpoints | 1 | +100 / −85 |
| C | `a1e3dd0` | chore: typing, logging, lint, README | 26 | +253 / −71 |

(This report is committed separately as a 4th commit, per instructions.)

### Per-file stats

**A — `9c55773`** (routers extracted from `main.py`; static assets moved):
```
main.py                     +14/-1117     app/routes/ai.py         +141/-0
app/__init__.py             +49/-0        app/routes/analyze.py    +186/-0
app/config.py                +5/-1        app/routes/frontend.py    +47/-0
app/modules/congress.py      +1/-1        app/routes/macro.py      +442/-0
.gitignore                   +3/-3        app/routes/notes.py       +38/-0
CLAUDE.md                    +2/-2        app/routes/quotes.py     +118/-0
README.md                    +1/-1        app/routes/search.py     +140/-0
app/routes/__init__.py       +0/-0
# pure renames (git -M, +0/-0): index.html, manifest.json, sw.js, icon.svg,
#   generate_icons.py  → static/ ;  module-pattern.md → docs/
```

**B — `3fbd358`**: `app/routes/analyze.py` +100/−85 (only file touched).

**C — `a1e3dd0`**:
```
README.md               +31/-4     app/modules/premium_demo.py  +3/-0
ruff.toml (new)         +21/-0     app/modules/quote.py         +5/-0
app/config.py           +21/-0     app/modules/ratings.py      +12/-3
app/modules/earnings.py +15/-6     app/modules/technicals.py   +14/-6
app/modules/news.py     +13/-5     app/routes/ai.py             +6/-2
app/modules/options.py  +12/-4     app/routes/analyze.py       +13/-9
app/modules/peers.py    +12/-5     app/routes/frontend.py       +8/-5
app/modules/company.py   +4/-0     app/routes/macro.py          +5/-1
app/modules/congress.py  +7/-2     app/routes/notes.py          +5/-2
app/modules/financials.py+7/-5     app/routes/quotes.py        +13/-8
app/modules/insider.py   +7/-1     app/routes/search.py         +6/-2
app/__init__.py          +4/-1     app/utils.py                 +3/-0
pytest.ini               +5/-0     requirements-dev.txt         +1/-0
```

---

## 2. Gate results per phase

The gate (all four must pass before committing and moving on): (a) `pytest` 5/5
under python3.11 incl. network tests; (b) `uvicorn main:app` boots with a clean
log; (c) `/analyze/AAPL` returns `error == None` with populated modules; (d) `/`
serves the SPA and `/manifest.json`, `/sw.js`, `/icon-192.png` return 200.

| Gate check | Phase A | Phase B | Phase C |
|---|---|---|---|
| pytest (python3.11, incl. network) | 5 passed (21.4s) | 5 passed (21.5s) | 5 passed (20.4s), **0 warnings** |
| `uvicorn main:app` clean boot | ✅ no errors | ✅ no errors | ✅ no errors |
| `/analyze/AAPL` error=None + 10 modules populated | ✅ | ✅ | ✅ |
| `GET /` SPA + `/manifest.json` + `/sw.js` + `/icon-192.png` = 200 | ✅ | ✅ | ✅ |
| `ruff check .` | n/a | n/a | ✅ All checks passed |

Extra equivalence checks run at each gate (beyond the required four):

| Extra check | A | B | C |
|---|---|---|---|
| OpenAPI operations (16 path×method×operationId+params) identical | ✅ | ✅ | ✅ |
| `GET /` bytes identical to baseline (md5 `d336742…`) | ✅ | ✅ | ✅ |
| `/analyze/AAPL?mode=premium` structure skeleton identical | ✅ | ✅ | ✅ |
| `analyze()` JSON key order identical (free + premium) | ✅ | ✅ | ✅ |
| SSE event sequence identical (23 free / 29 premium events) | n/a¹ | ✅ | ✅ |

¹ Phase A did not touch the stream logic; the SSE reference sequence was captured
from post-A code and used as the invariant for B and C.

Boot logs for all three phases contained exactly the four uvicorn INFO lines
(`Started server process` → `Application startup complete` → `Uvicorn running`)
and nothing else — no tracebacks, no app-level ERROR/WARNING. The `numa` logger
defaults to WARNING, so the new `logger.debug(...)` fallbacks stay silent on a
normal run (set `NUMA_LOG_LEVEL=DEBUG` to surface them).

---

## 3. Diff vs baselines (captured before Phase A)

### 3a. `GET /` bytes — **identical**
Final md5 `d33674269faf47fe777e9cdcaeddf58d` == baseline md5. `index.html` was a
pure `git mv` into `static/`; `serve_frontend` returns its bytes unchanged.

### 3b. `/analyze/AAPL?mode=premium` **structure** — **identical**
Type-only skeleton (keys → types, list→first-element shape) is byte-identical to
baseline. Top-level key order is also identical:
`ticker, mode, timestamp, company, quote, financials, technicals, options_flow,
insider_activity, news_sentiment, peers, earnings, analyst_ratings, dark_pool,
gamma_exposure, congressional_trades, error`. `congressional_trades` is an
`{"error": "QUIVER_API_KEY not configured"}` bag in both (no Quiver key present),
so that is a consistent baseline, not a regression.

### 3c. `/openapi.json` — **two categories of difference, both explained**

An order-insensitive deep diff found **exactly 24 differences, plus a path
ordering change** — nothing else. The `info` block, all 16 operations
(path × method × operationId × parameters × requestBody), the 4 component schemas
(`SynthesisRequest`, `NumaRequest`, `HTTPValidationError`, `ValidationError`),
and every error response are byte-identical.

**(1) Path ordering changed (Phase A) — order only, set identical.**
Routers group their routes contiguously, so the `paths` object is now grouped by
router instead of interleaved:
```
baseline: / manifest sw icon192 icon512 notes health analyze quote quotes
          analyze/stream synthesize numa macro search
final:    / manifest sw icon192 icon512 analyze analyze/stream quote quotes
          notes synthesize numa macro search health
```
The only relocations forced by the file layout are `/health` (grouped with
`/search` in `search.py`, so it moved to the end) and `/analyze/stream/{ticker}`
(grouped with `/analyze/{ticker}` in `analyze.py`, so it moved up next to it).
OpenAPI path order is not something a client can depend on; the set of paths and
all their operations are unchanged.

**(2) 24 keys added across 8 endpoints' 200-response schemas (Phase C).**
Adding return type hints (`-> dict` / `-> list`) to the JSON endpoints makes
FastAPI attach an accurate response schema. Each of the 8 endpoints gains
`type` + `title` + (`additionalProperties` for objects / `items` for the `/notes`
array) = 3 keys × 8 = 24:
```
GET /analyze/{ticker}  GET /quote/{ticker}  GET /quotes  GET /macro
GET /health  GET /search  POST /notes  →  type: object
GET /notes  →  type: array
```
This changes the API's self-description only. The **served bytes are
byte-identical** with and without the hint (verified directly on a representative
payload, and confirmed by the identical `/` and premium-structure diffs). This is
the one place I chose completeness of "type hints on all route signatures" over
keeping `/openapi.json` byte-identical; see Deviations.

---

## 4. AST-level confirmation of moved function bodies

Method: parse every top-level function from the baseline (`e06e7fc` `main.py` +
`app/modules/*.py`) and from HEAD (`app/routes/*.py` + `app/modules/*.py`), and
compare the AST **of the body only** (signatures/decorators excluded, so
type-hint additions do not register as body changes). Script kept at
`/tmp/ast_check.py`; per-function source diffs at `/tmp/ast_diff.py`.

**Result: 44 functions compared. 28 bodies byte-identical. 16 changed — every
change classified below and confirmed by line-level diff. Zero unexplained
changes. One new function (`_group_by_label`, the Phase B helper). No function
was removed.**

**28 identical** (moved verbatim / untouched bodies), incl. `get_company`,
`get_quote`, `get_technicals`, `get_insider_activity`,
`get_options_flow_premium_demo`, `get_dark_pool_demo`, `get_gex_demo`,
`get_congressional_trades`, all six `compute_*` overlays, `_ai_news_sentiment`,
`get_macro`, `fred_get`, `fred_latest`, `get_fed_probabilities`, `_macro_clean`,
`symbol_search`, `_alnum`, `health`, `get_notes`, `save_notes`, `synthesize`,
`numa_chat`.

**16 changed — by category:**

| Category | Functions | What changed in the body |
|---|---|---|
| **Phase A** static-path | `serve_frontend`, `serve_manifest`, `serve_sw`, `serve_icon_192`, `serve_icon_512` | `BASE_DIR` → `STATIC_DIR` in the `FileResponse(...)` path (required by the `static/` move). Nothing else. |
| **Phase B** registry | `analyze`, `analyze_stream` | Full, intended rewrite onto `MODULE_REGISTRY` (the whole point of Prompt 6). |
| **Phase C** logging | `get_analyst_ratings` (1), `get_earnings` (2), `get_options_flow` (1), `get_peers` (2), `get_news_sentiment` (2), `compute_pe_history` (2), `live_quote` (1), `batch_quotes` (2) | `except Exception:` / `pass` → `except Exception as exc:` / `logger.debug(..., exc_info=exc)`. Control flow unchanged (still swallow-and-continue). |
| **Phase C** dead-code | `get_financials` | Removed 3 ruff-F841 unused locals: `cashflow = stock.cashflow`, `rev_vals`, `gp_vals`. Output unchanged; `cashflow` was never read, so this also drops one unused yfinance fetch. |

Type-hint-only signature changes (`stock: yf.Ticker`, `-> dict/list/Response`)
did **not** alter any body and so are not in the "changed" list — e.g.
`get_technicals` got `stock: yf.Ticker` but its body is byte-identical.

---

## 5. Deviations from the instructions

1. **JSON-endpoint return hints change `/openapi.json`.** Adding `-> dict`/`-> list`
   to the eight JSON endpoints (to satisfy "type hints on all route signatures")
   causes FastAPI to attach response schemas, i.e. the 24-key OpenAPI diff in §3c.
   Served payloads are provably byte-identical, so there is no *runtime* behavior
   change, but the API's self-description did change. A stricter reading of "no
   behavior changes" would omit these return hints to keep `/openapi.json`
   byte-identical (only Phase A's reordering would remain). I chose completeness
   and documented the delta rather than leaving eight signatures unannotated.
   Response-returning endpoints use `-> FileResponse`/`-> StreamingResponse`,
   which FastAPI ignores for schema generation (no OpenAPI change).

2. **`/static` now serves only `static/`, not the whole repo root.** Baseline
   mounted `StaticFiles(directory=BASE_DIR)` (repo root); final mounts `STATIC_DIR`.
   This is the intended consequence of moving assets into `static/`, and it is a
   security improvement, but it *is* an externally-observable change:
   `GET /static/main.py` was 200 (source exposed) and is now 404. Every path the
   frontend actually uses still resolves — `GET /static/icon-192.png` and
   `/static/icon-512.png` (referenced by `manifest.json`) both return 200, as do
   the explicit `/icon-192.png` / `/manifest.json` / `/sw.js` routes. Called out
   because it is the one genuine behavior change in the run.

3. **Fixed two `module-pattern.md` references beyond the two named.** The
   instructions said to update CLAUDE.md and README.md after moving the doc into
   `docs/`. Two more references existed in code comments (`app/config.py`,
   `app/modules/congress.py`); I updated those too so nothing points at a stale
   path.

4. **Icon PNGs moved on disk, not via `git mv`.** `icon-192.png` / `icon-512.png`
   are git-ignored (generated). They were `mv`'d into `static/` (so the app can
   serve them) and `.gitignore` was updated to `static/icon-*.png`. Only the
   tracked assets (`index.html`, `manifest.json`, `sw.js`, `icon.svg`,
   `generate_icons.py`) were `git mv`'d.

5. **`main.py`'s long header comment was dropped.** Reducing `main.py` to the
   `create_app()` shim removed its ~50-line setup/premium-activation guide
   comment. The premium-activation notes still live in the per-module code and
   CLAUDE.md; the setup steps are in `run.py`/README. No code was lost.

6. **The TestClient deprecation warning is silenced, not "fixed at the source".**
   Starlette 1.3's TestClient warns that its httpx integration is deprecated
   ("install httpx2 instead") — that is internal to Starlette and not something we
   can fix without dropping httpx (which FastAPI needs). The pragmatic fix is a
   `pytest.ini` `filterwarnings` entry, so the suite reports 0 warnings. The
   warning still prints when `fastapi.testclient` is imported *outside* pytest
   (e.g. the ad-hoc verification scripts in this run show it); only the test suite
   is clean.

7. **`ruff` ignores `E501` and `E731`.** Long lines (the `SECTION_PROMPTS`
   templates, the aligned `MODULE_REGISTRY`, a few macro ternaries) and two
   concise local lambdas in `compute_fibonacci` are left as-is with a documented
   rationale in `ruff.toml`, rather than reflowing/​rewriting pre-existing code.
   Everything else ruff flags (import sorting across the package; three dead
   locals) was fixed.

---

## 6. Known issues / deliberately NOT done (morning checklist)

- [ ] **CORS is still `allow_origins=["*"]`.** REFACTOR_PLAN lists "CORS tightened
      to localhost origins" as a later, independent commit; out of scope for 5–7.
- [ ] **`/static` exposure narrowing (Deviation §2)** — confirm this is desired.
      It's a behavior change, even if a beneficial one.
- [ ] **`index.html` (321 KB) not split** into `css/`/`js/`. REFACTOR_PLAN's own
      multi-commit "later" track; untouched tonight.
- [ ] **No per-module unit tests / recorded fixtures.** The suite is still 5 live
      smoke tests that depend on Yahoo being reachable; offline they auto-skip to
      3/5. REFACTOR_PLAN "later" item.
- [ ] **No GitHub Actions (ruff + pytest on push).** REFACTOR_PLAN "later" item.
- [ ] **`SynthesisPayload` empty class** in `app/routes/ai.py` is dead code, kept
      verbatim from the original to avoid a behavior/surface change. Safe to delete.
- [ ] **`logger` is import-time configured in `app/config.py`.** Fine for this
      app, but if `config` is ever imported by another process that manages its own
      logging, the handler/`propagate=False` may want revisiting.
- [ ] **httpx2 not adopted** (see Deviation §6); revisit when Starlette forces it.
- [ ] **Premium modules still demo-only** (unchanged; not in scope) —
      `congressional_trades` returns its error bag without a Quiver key.

---

## Bottom line

All three phases landed green under the full gate, one concern per commit, app
bootable and `/analyze/AAPL` working at every step. Observable runtime behavior
of every endpoint is unchanged (payload bytes, key order, SSE sequence, premium
structure all verified identical), with two disclosed exceptions: the `/openapi.json`
self-description (path reordering + 8 added response schemas) and the `/static`
mount narrowing. The AST check confirms no moved function body changed except the
logging-line conversions, the one dead-code removal, and the deliberate Phase A
static-path and Phase B registry rewrites.
