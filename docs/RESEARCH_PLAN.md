# Numa — Research Engine + Skills track

Multi-agent research inside Numa, adapted from mcravi8/agentic-orchestrator
(the "AO" repo) but with none of its infrastructure. Read this before any
R-phase prompt.

## Architecture (decided)

**One engine, two doors.** A single research engine (plan → execute subtasks
against Numa's data modules → synthesize) with two entry points:

1. **Skills** (deliberate door): saved, editable pipelines. User describes a
   skill in a sentence → planner proposes a pipeline → user edits → saves.
   Stored in `skills.json` at repo root (same pattern as `notes.json`).
2. **Chat auto-trigger** (automatic door, built LAST): the /numa chat decides
   per question whether to answer directly (default, strongly biased) or
   deploy a throwaway auto-plan. Never editable mid-chat, but always visible
   as live progress rows.

## Non-negotiable constraints

- **No new infrastructure.** No database, no Docker, no auth, no object
  store, no new frontend framework. JSON files + the existing Anthropic
  client + existing SSE patterns. `uvicorn main:app` stays the only runtime.
- **Standing rule holds**: every commit boots and `/analyze/AAPL` returns
  error=None.
- **Plan schema is AO's, verbatim**, for future interop:
  `{"subtasks": [{"name", "description", "depends_on": []}]}`.
  Skill wire shape mirrors AO's Skill DTO (name, description, version,
  plan template) minus DB fields.
- **Subtask tool menu = Numa's MODULE_REGISTRY keys** (technicals,
  financials, news_sentiment, ...) plus `macro` and a free-form
  `reason` subtask type (Claude call over prior subtask outputs, no fetch).
- **Cost guards**: auto-mode plans hard-capped at 5 subtasks; skill plans at
  8. Planner degrades gracefully to a single-subtask plan on malformed JSON
  (AO planner behavior). Model names come from config constants, not
  hard-coded in call sites.
- **Frontend**: new JS goes in `static/js/07-research.js` as a classic
  script loaded after 06 — NOT an ES module (global-scope contract, see
  README). Every frontend commit bumps the sw.js cache version and updates
  its precache list.
- **Engine is testable offline**: all engine tests mock the LLM client; no
  test may require a live Anthropic call. CI must exercise the engine.

## Phases (one commit each)

- R1 backend engine core (no HTTP): `app/research/` — schemas, planner,
  executor. Mocked-client unit tests.
- R2 HTTP + SSE: `/research/plan`, `/research/run`, `/research/stream/{id}`.
- R3 skills persistence: `skills.json`, CRUD + `/skills/propose`.
- R4 frontend: Skills section UI (list, editor, propose-new flow, run with
  plan preview → live progress → result savable to Notes).
- R5 chat auto-trigger: classifier biased hard toward direct answering;
  deploy only on clear multi-step signal; capped; progress rows in chat;
  "save as skill" affordance.

R1–R3 are backend-only and gate on pytest; they can run as one overnight
session (three separate commits). R4 and R5 gate on headless-browser
verification and run as separate sessions.
