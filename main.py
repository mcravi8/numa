# ============================================================
# RESEARCH TERMINAL — main.py
# Personal 360° Stock Analysis Terminal
# ============================================================
# Backward-compatible entrypoint. The backend now lives in the ``app`` package:
#
#   app/config.py          env, API keys, shared clients, paths
#   app/utils.py           JSON-safety helpers (_json_safe, _ovr)
#   app/modules/           the per-ticker data modules (see docs/module-pattern.md)
#   app/routes/            the endpoints, split into APIRouter files
#   app/__init__.py        create_app(): CORS, router registration, /static mount
#
# ``uvicorn main:app`` (equivalently ``python run.py``) still works because this
# module exposes ``app`` built by the factory.
#
# SETUP:
#   1. pip install -r requirements.txt
#   2. cp .env.example .env  →  fill in your API keys
#   3. python run.py         →  http://localhost:8000
# ============================================================

from app import create_app

app = create_app()
