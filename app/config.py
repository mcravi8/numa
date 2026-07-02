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
