"""Config: environment, API keys, shared clients, paths, and the app logger.

Single source of truth for everything read from the environment. Also builds the
one shared "numa" stdlib logger used across the modules and routes.
"""
# ============================================================
# === CONFIG — env, API keys, shared clients, constants ===
# ============================================================
# Single source of truth for everything the app reads from the environment.
# ``load_dotenv()`` runs once here, at import time, and every API key is read
# exactly once into a named constant below. Modules and routes import these
# names instead of calling ``os.getenv`` themselves — so a key's env-var name
# lives in exactly one place, and the shared clients (Anthropic, Finnhub) are
# constructed a single time rather than rebuilt on every request.

import logging
import os
import pathlib

import anthropic
from dotenv import load_dotenv

load_dotenv()

# --- Logger — one configured "numa" logger shared by modules and routes -----
# Defaults to WARNING so a normal run stays quiet; set NUMA_LOG_LEVEL=DEBUG to
# surface the previously-silent swallowed exceptions (fetch fallbacks, partial
# parses). Its own handler + propagate=False keep it from doubling up on
# uvicorn's root logging.
logger = logging.getLogger("numa")
if not logger.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)s numa.%(module)s: %(message)s")
    )
    logger.addHandler(_handler)
logger.setLevel(os.getenv("NUMA_LOG_LEVEL", "WARNING").upper())
logger.propagate = False

# --- API keys (each read once, here) ------------------------------------
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
FINNHUB_API_KEY = os.getenv("FINNHUB_API_KEY", "")
QUIVER_API_KEY = os.getenv("QUIVER_API_KEY", "")
FRED_KEY = os.getenv("FRED_API_KEY", "")
UNUSUAL_WHALES_API_KEY = os.getenv("UNUSUAL_WHALES_API_KEY", "")
POLYGON_API_KEY = os.getenv("POLYGON_API_KEY", "")

# --- CORS — allowed browser origins for cross-origin fetch/XHR -----------
# The SPA is served same-origin by FastAPI itself, so the default list
# restricts nothing legitimate. Override with a comma-separated CORS_ORIGINS
# env var to serve the frontend from somewhere else.
CORS_ORIGINS = [
    o.strip()
    for o in os.getenv(
        "CORS_ORIGINS", "http://localhost:8000,http://127.0.0.1:8000"
    ).split(",")
    if o.strip()
]

# --- SEC EDGAR — no key, just an identifying User-Agent header -----------
SEC_HEADERS = {"User-Agent": "ResearchTerminal demo@researchterm.com"}

# --- Anthropic / Claude — one shared client, built once from the key -----
ANTHROPIC_CLIENT = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

# --- Research engine — model names in one place (not hard-coded at call sites).
# The plan/reason/synthesis steps of app/research each read their model from the
# matching constant here so a model swap is a one-line edit (see RESEARCH_PLAN.md).
RESEARCH_PLANNER_MODEL = os.getenv("RESEARCH_PLANNER_MODEL", "claude-sonnet-4-6")
RESEARCH_REASON_MODEL = os.getenv("RESEARCH_REASON_MODEL", "claude-sonnet-4-6")
RESEARCH_SYNTHESIS_MODEL = os.getenv("RESEARCH_SYNTHESIS_MODEL", "claude-sonnet-4-6")
# The chat auto-research classifier is a cheap Haiku-class gate (a few tokens).
RESEARCH_CLASSIFIER_MODEL = os.getenv("RESEARCH_CLASSIFIER_MODEL", "claude-haiku-4-5-20251001")
# The clarifier gate (app/research/clarifier.py) is the same Haiku-class tier: a
# single cheap call, hard-biased toward asking nothing.
RESEARCH_CLARIFIER_MODEL = os.getenv("RESEARCH_CLARIFIER_MODEL", "claude-haiku-4-5-20251001")
# The output validator (app/research/validator.py) scores the finished memo — a
# Sonnet-class judgement, weightier than the Haiku gates.
RESEARCH_VALIDATOR_MODEL = os.getenv("RESEARCH_VALIDATOR_MODEL", "claude-sonnet-4-6")

# --- Chat auto-research kill-switch --------------------------------------
# When off, the /numa chat never deploys an auto-plan — every question is
# answered directly. Set NUMA_AUTO_RESEARCH=0 to force direct-only.
NUMA_AUTO_RESEARCH = os.getenv("NUMA_AUTO_RESEARCH", "1").strip().lower() not in (
    "0", "false", "no", "off", "",
)

# --- Clarifier kill-switch -----------------------------------------------
# When off, neither door (skills propose / chat auto-deploy) ever asks a
# clarifying question — planning proceeds straight from the objective. Set
# NUMA_CLARIFIER=0 to force silent (never-ask) behaviour.
NUMA_CLARIFIER = os.getenv("NUMA_CLARIFIER", "1").strip().lower() not in (
    "0", "false", "no", "off", "",
)

# --- Validator kill-switch -----------------------------------------------
# When off, the executor skips scoring the synthesized memo entirely — no
# validator call, no retry, no quality badge. Set NUMA_VALIDATOR=0 to disable.
NUMA_VALIDATOR = os.getenv("NUMA_VALIDATOR", "1").strip().lower() not in (
    "0", "false", "no", "off", "",
)

# --- Research cost estimate — list prices ($ per MILLION tokens) ---------
# Powers both the live "usage" event's USD and the pre-run /research/estimate
# projection. Values are the spec figures in $/M tokens: (input, output); the
# division by 1e6 happens at the point of use (usd = (in*p_in + out*p_out)/1e6).
# These keys must also be what the router's model ids and MODEL_ALIASES resolve
# to, so any routed/overridden model prices from this one table.
RESEARCH_PRICE_PER_M = {
    "claude-haiku-4-5-20251001": (1.00, 5.00),
    "claude-sonnet-4-6": (3.00, 15.00),
    "claude-opus-4-8": (15.00, 75.00),
}
_DEFAULT_PRICE_PER_M = (3.00, 15.00)   # unknown model → priced as Sonnet


def estimate_cost_usd(model: str, input_tokens: int, output_tokens: int) -> float:
    """Estimated USD for a call, from the per-million list-price table above."""
    inp, out = RESEARCH_PRICE_PER_M.get(model, _DEFAULT_PRICE_PER_M)
    return ((input_tokens or 0) * inp + (output_tokens or 0) * out) / 1e6


# --- Research routing — per-step model tiers -----------------------------
# The router (app/research/router.py) maps a step's kind to a model: fetch → no
# model (a data-module call, no LLM cost), reason → RESEARCH_REASON_MODEL,
# synthesis → RESEARCH_SYNTHESIS_MODEL. A step may override the tier with a short
# alias ("haiku"/"sonnet"/"opus"); these are the ids those aliases resolve to
# (and they key RESEARCH_PRICE_PER_M, so an overridden step still prices right).
MODEL_ALIASES = {
    "haiku": "claude-haiku-4-5-20251001",
    "sonnet": "claude-sonnet-4-6",
    "opus": "claude-opus-4-8",
}

# Upper bound the cost estimator clamps a step's projected output tokens to
# (app/research/cost_estimate.py). Matches the largest real max_tokens the
# executor issues (the streaming synthesis call), so the projection is an
# upper-ish bound rather than an under-count.
RESEARCH_MAX_OUTPUT_TOKENS = int(os.getenv("RESEARCH_MAX_OUTPUT_TOKENS", "1200"))

# --- Finnhub — one shared client, or None when no key is configured ------
# (news and peers use this instead of rebuilding a client on every call).
# Pin an explicit 10-second timeout: news and peers are fetchers, and
# docs/module-pattern.md's "fetcher" rule wants their external calls bounded —
# so we assert 10s here rather than silently inheriting the finnhub
# library's default. (company_news / news_sentiment / company_peers take no
# per-call timeout kwarg, so the shared client is the one place to set it.)
if FINNHUB_API_KEY:
    import finnhub
    FINNHUB_CLIENT = finnhub.Client(api_key=FINNHUB_API_KEY)
    FINNHUB_CLIENT.DEFAULT_TIMEOUT = 10
else:
    FINNHUB_CLIENT = None

# --- Quiver Quantitative — congressional (STOCK Act) trade disclosures. --
# Auth note: Quiver's maintained Python client sends "Authorization: Token
# <key>"; their published OpenAPI spec documents "Bearer <key>". The server
# accepts both prefixes, so we follow the official client. If a valid key ever
# returns 401, flip "Token" to "Bearer" on the line below.
QUIVER_BASE = "https://api.quiverquant.com/beta"
QUIVER_HEADERS = {"Accept": "application/json",
                  "Authorization": f"Token {QUIVER_API_KEY}"}

# --- File paths — BASE_DIR is the repo root (this file lives in app/) -----
BASE_DIR = pathlib.Path(__file__).parent.parent
# Frontend/PWA assets (index.html, manifest.json, sw.js, icons) live here and
# are both served by the explicit frontend routes and mounted at /static.
STATIC_DIR = BASE_DIR / "static"
# notes.json stays at the repo root (git-ignored personal data), not in static/.
NOTES_FILE = BASE_DIR / "notes.json"
# skills.json — saved research pipelines, same git-ignored-personal-data pattern
# as notes.json (read/written whole-file by the skills routes).
SKILLS_FILE = BASE_DIR / "skills.json"
