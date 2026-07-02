# Research Run Report — Phases R1–R3 (engine + HTTP + skills)

Self-evaluation of the backend research track (`docs/RESEARCH_PLAN.md`), executed
as three commits (R1 engine core, R2 HTTP/SSE, R3 skills store). Written to be
honest, not flattering; where something is only partially verified it says so.
Same format as `docs/NIGHT_RUN_REPORT.md`.

Runtime: Homebrew **python3.11** (3.11.13), as required by CLAUDE.md. Network was
up for the whole run. Per the prompt's global rules, the phase gate ran pytest
with `OFFLINE=1` so **every new engine/HTTP/skills test executes offline against a
mocked Anthropic client** — no live Claude call happens in any new test. The two
pre-existing `@pytest.mark.network` smoke tests (which hit live Yahoo Finance, not
Anthropic) are force-skipped under `OFFLINE=1`; they were separately confirmed
green with network up (33 passed online). `/analyze/AAPL` was verified live at
every gate.

---

## 1. Commits produced

Three commits, in order, each its own concern. Nothing was pushed. This report is
committed separately as a 4th commit, per instructions.

| # | SHA | Subject | Files | Lines |
|---|-----|---------|-------|-------|
| R1 | `22fca67` | feat(research): engine core — planner + executor | 6 | +629 |
| R2 | `2a5d6b7` | feat(research): plan/run/stream endpoints | 4 | +339 |
| R3 | `383e9ba` | feat(research): skills persistence + propose | 5 | +237 / −1 |

Total: **+1205 / −1** across the three phases. Every file added is new code plus
its offline test; the only pre-existing files touched are `app/__init__.py`
(router registration), `app/config.py` (constants + `SKILLS_FILE`), `.gitignore`
(`skills.json`), and `tests/conftest.py` (shared mocked-client fixtures). No
existing behaviour was modified.

### Per-file stats

**R1 — `22fca67`** (the engine, no HTTP):
```
app/config.py                  +7      # RESEARCH_{PLANNER,REASON,SYNTHESIS}_MODEL
app/research/__init__.py       +11
app/research/schemas.py        +70     # Plan/Subtask (AO verbatim) + Skill DTO + render_plan
app/research/planner.py        +101    # one Claude call; degrade; 5/8 caps
app/research/executor.py       +196    # async generator; reuse MODULE_REGISTRY adapters
tests/test_research_engine.py  +244    # mocked client + FakeTicker, 11 tests
```

**R2 — `2a5d6b7`** (HTTP + SSE):
```
app/routes/research.py     +118    # /research/plan, /research/run, /research/stream/{id}
app/__init__.py            +7      # register router (aliased — see §3)
tests/conftest.py          +85     # FakeAnthropic + patch_research fixtures (shared)
tests/test_research_api.py +129    # 5 offline smoke tests
```

**R3 — `383e9ba`** (skills store):
```
app/routes/skills.py     +122    # CRUD + /skills/propose, whole-file like notes
app/config.py            +3      # SKILLS_FILE at repo root
app/__init__.py          +3/-1   # register router
.gitignore               +1      # skills.json (user data)
tests/test_skills_api.py +109    # 5 offline tests (tmp_path skills file)
```

---

## 2. Gate results per phase

The gate (all must pass before committing and moving on): (a) `OFFLINE=1 pytest`
(python3.11) all green with the new engine tests running offline (mocked LLM, no
live Anthropic call); (b) `ruff check` clean; (c) `uvicorn main:app` boots with a
clean log; (d) `/analyze/AAPL` returns `error == None` with a populated payload.

| Gate check | R1 | R2 | R3 |
|---|---|---|---|
| `OFFLINE=1 pytest` (python3.11) all green | ✅ 21 passed, 2 skipped | ✅ 26 passed, 2 skipped | ✅ 31 passed, 2 skipped |
| new tests run offline, no live Anthropic | ✅ 11 | ✅ +5 = 16 | ✅ +5 = 21 |
| `ruff check app/ tests/` | ✅ (after auto-fix, see §3) | ✅ (after auto-fix) | ✅ clean first try |
| `uvicorn main:app` clean boot (`/health` 200) | ✅ no errors | ✅ no errors | ✅ no errors |
| `/analyze/AAPL` error=None + populated | ✅ | ✅ | ✅ |

Extra checks run beyond the required four:

| Extra check | R1 | R2 | R3 |
|---|---|---|---|
| `from main import app` imports, N routes | ✅ 12 | ✅ | ✅ |
| OpenAPI gains only the new routes, nothing else changes | n/a | ✅ `/research/plan`, `/research/run`, `/research/stream/{run_id}` | ✅ `/skills`, `/skills/{skill_id}`, `/skills/propose` |
| No stray `skills.json` written to repo root by tests | n/a | n/a | ✅ (tests use `tmp_path`) |
| full suite online (network smoke incl.) | — | — | ✅ 33 passed (21.0s) |

Boot logs for all three phases contained only the normal uvicorn INFO lines and
`GET /health 200` — no tracebacks, no app-level ERROR/WARNING.

---

## 3. Design decisions & deviations from the prompt

Faithful to `RESEARCH_PLAN.md` throughout. Where the prompt left a choice, the
decision and reasoning:

1. **Subtask `name` doubles as the tool selector.** AO's schema is verbatim
   (`{name, description, depends_on}`) with no separate "tool" field, and the
   prompt says the tool menu *is* the set of allowed subtask names. So the
   executor resolves the tool from the `name`: it normalizes case/spacing and
   strips a trailing numeric suffix, so `reason` and `reason_2` both resolve to
   the `reason` tool — this lets a plan reuse a tool while keeping unique names
   for `depends_on`. Anything not matching a known fetch tool falls back to
   `reason` (which is also exactly what the degraded single-subtask plan is).

2. **Executor reuses the analyze endpoints' `MODULE_REGISTRY` verbatim.** Rather
   than re-implement fetching, a fetch subtask calls the same `ModuleSpec.fetch`
   signature adapter the analyze endpoints use, over one `yf.Ticker/info` per
   ticker (`_build_ctx`, mirroring `analyze()`). This is why a subtask named
   `technicals` runs *precisely* what `/analyze` runs. The tool catalog
   (`FETCH_TOOLS`, `ALLOWED_TOOLS`) is derived once from `MODULE_REGISTRY` in
   `executor.py`; the planner imports it, so both sides can never disagree.

3. **Multi-ticker fetch.** The prompt's per-ticker pattern doesn't say how a
   fetch subtask spans `tickers[]`. Chosen: a fetch subtask runs once per ticker
   and returns `{ticker: <module bag>}`; a per-ticker module failure degrades to
   that ticker's error bag, not the whole subtask. `macro` is ticker-agnostic
   (`{"macro": ...}`).

4. **Injectable dependencies for offline testing.** `run_plan(...)` and
   `build_plan(...)` take an optional `client=` and `stock_factory=`, defaulting
   to the shared `ANTHROPIC_CLIENT` and a live `yf.Ticker` fetch. Tests inject a
   `FakeAnthropic` (both `messages.create` and `messages.stream`) and the
   recorded `FakeTicker`, so nothing hits the network or Anthropic. The HTTP
   tests achieve the same by monkeypatching the module-level client /
   `_default_stock_factory` via the shared `patch_research` conftest fixture.

5. **Per-subtask errors vs. fatal errors.** A subtask that raises yields a
   `subtask_completed` event whose `data` is an error bag (`{"error": ...}`) and
   the walk continues — this is the "error-bag events without aborting" the
   prompt asks for. The distinct top-level `error` event is reserved for a fatal
   run-level failure (ticker load or synthesis crash), which does end the run.

6. **`app/routes/research.py` vs. the `app/research/` package — name collision.**
   `from app.routes import research` in `create_app()` would rebind the
   `app.research` *attribute* to the routes module, shadowing the engine package
   and breaking `import app.research.executor`. Fixed by importing the routes
   module aliased (`from app.routes import research as research_routes`). Caught
   by the R2 tests before commit; documented inline in `app/__init__.py`.

7. **Model names as config constants.** Added `RESEARCH_PLANNER_MODEL`,
   `RESEARCH_REASON_MODEL`, `RESEARCH_SYNTHESIS_MODEL` (env-overridable,
   defaulting to `claude-sonnet-4-6`). The engine reads these; call sites never
   hard-code a model. Existing endpoints' hard-coded model strings were left
   untouched (out of scope — one concern per commit).

8. **Ruff auto-fixes.** R1 and R2 each needed a trivial `ruff --fix` for import
   ordering / one unused import left over from an earlier draft (`asyncio`, after
   I settled on iterating the synthesis stream synchronously rather than via
   `to_thread`). Fixed before the respective commit; final tree is ruff-clean.

9. **`RunRequest` accepts an optional `objective`/`mode`.** The prompt's run body
   is `{plan, tickers[]}`; I additionally accept `objective` and `mode` (both
   optional, defaulted) so the frontend can carry the objective from the plan
   step into synthesis. Purely additive; the documented `{plan, tickers[]}` body
   works unchanged.

---

## 4. Known issues / morning checklist

Nothing is broken, but these are honest caveats and the natural next steps:

- **Blocking calls in the async generator.** `run_plan` is an `async` generator
  but the module fetches and the planner/reason Claude calls are synchronous and
  run inline (no `asyncio.to_thread`), matching the existing sync `analyze_stream`
  and fine for a single-user personal tool — but a long research run will block
  the event loop for other requests. If concurrency ever matters, wrap the
  discrete blocking calls in `to_thread`.
- **`macro` subtasks are not covered by an offline test.** `get_macro()` hits
  FRED/yfinance and is cached; the executor wires it, but the offline tests
  deliberately exercise only fetch-transformer tools + `reason` (which is what
  the FakeTicker fixtures support). Verify a `macro` subtask against live data
  manually before relying on it.
- **Premium tools in a plan run demo data.** `dark_pool` / `gamma_exposure` /
  `congressional_trades` are in `ALLOWED_TOOLS`; without keys they return the
  same demo bags the analyze endpoint returns. Intended, but worth remembering
  when a plan includes them.
- **Runs are in-memory and single-use.** A server restart between `POST
  /research/run` and `GET /research/stream/{id}` drops the run (clean SSE error).
  This is by design (no new infrastructure) but means no resume.
- **Synthesis/reason context is truncated** to ~6k/12k chars of JSON to bound
  cost; a very large multi-ticker plan may feed the model a clipped view of the
  findings. `_CONTEXT_CHARS` in `executor.py` is the knob.
- **Frontend not built yet.** R4 (Skills section UI: list/editor/propose/run with
  live progress → save to Notes) and R5 (chat auto-trigger) are the remaining,
  separately-gated tracks. New JS must go in `static/js/07-research.js` as a
  **classic script** (global-scope contract) and each frontend commit must bump
  `sw.js`'s cache version + precache list (see `RESEARCH_PLAN.md`).

### Morning checklist

1. `OFFLINE=1 python3.11 -m pytest -q` → expect 31 passed, 2 skipped.
2. `ruff check app/ tests/` → All checks passed.
3. `python3.11 -m uvicorn main:app` boots; `curl /health` → 200.
4. `curl /analyze/AAPL` → `error: null`, populated modules.
5. Smoke the new flow end-to-end with a real key set:
   `POST /research/plan {objective, tickers}` → review plan →
   `POST /research/run {plan, tickers}` → `GET /research/stream/{run_id}` streams
   `plan → subtask_* → synthesis_token* → complete → [DONE]`.
6. `POST /skills/propose {description}` → draft; `POST /skills` to save;
   `GET/PUT/DELETE /skills` round-trip.
