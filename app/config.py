# ============================================================
# === CONFIG — env, API keys, shared clients, constants ===
# ============================================================
# Single source of truth for everything the app reads from the environment.
# ``load_dotenv()`` runs once here, at import time, and every API key is read
# exactly once into a named constant below. Modules and routes import these
# names instead of calling ``os.getenv`` themselves — so a key's env-var name
# lives in exactly one place, and the shared clients (Anthropic, Finnhub) are
# constructed a single time rather than rebuilt on every request.

import os
import pathlib

import anthropic
from dotenv import load_dotenv

load_dotenv()

# --- API keys (each read once, here) ------------------------------------
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
FINNHUB_API_KEY = os.getenv("FINNHUB_API_KEY", "")
QUIVER_API_KEY = os.getenv("QUIVER_API_KEY", "")
FRED_KEY = os.getenv("FRED_API_KEY", "")
UNUSUAL_WHALES_API_KEY = os.getenv("UNUSUAL_WHALES_API_KEY", "")
POLYGON_API_KEY = os.getenv("POLYGON_API_KEY", "")

# --- SEC EDGAR — no key, just an identifying User-Agent header -----------
SEC_HEADERS = {"User-Agent": "ResearchTerminal demo@researchterm.com"}

# --- Anthropic / Claude — one shared client, built once from the key -----
ANTHROPIC_CLIENT = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

# --- Finnhub — one shared client, or None when no key is configured ------
# (news and peers use this instead of rebuilding a client on every call).
if FINNHUB_API_KEY:
    import finnhub
    FINNHUB_CLIENT = finnhub.Client(api_key=FINNHUB_API_KEY)
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
NOTES_FILE = BASE_DIR / "notes.json"
