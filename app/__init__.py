"""Application package. ``create_app()`` assembles the FastAPI instance: CORS,
the seven route routers, and the catch-all /static mount.
"""
# ============================================================
# === APP FACTORY ===
# ============================================================
# create_app() assembles the FastAPI instance: CORS, the seven route
# routers, and the catch-all /static mount. main.py is reduced to
# ``from app import create_app; app = create_app()`` so ``uvicorn main:app``
# keeps working.
#
# Route order matters in FastAPI: the explicit routers are registered first
# and the catch-all StaticFiles mount is registered LAST so it never shadows
# an explicit route.

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import CORS_ORIGINS, STATIC_DIR
from app.routes import ai, analyze, frontend, macro, notes, quotes, search


def create_app() -> FastAPI:
    app = FastAPI(title="Research Terminal")
    # Restrict CORS to the localhost origins the SPA is served from (override
    # via CORS_ORIGINS). No allow_credentials: the app uses no cookies, so
    # credentialed cross-origin requests are neither needed nor permitted.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=CORS_ORIGINS,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Explicit routers first (frontend before the API routers).
    app.include_router(frontend.router)
    app.include_router(analyze.router)
    app.include_router(quotes.router)
    app.include_router(notes.router)
    app.include_router(ai.router)
    app.include_router(macro.router)
    app.include_router(search.router)

    # ── STATIC FILES (manifest, icons, sw.js) ──────────────────
    # Serves the frontend assets in static/ under /static. This MUST come
    # AFTER all explicit route definitions — a mount is a catch-all that
    # would otherwise shadow the routes declared above.
    app.mount(
        "/static",
        StaticFiles(directory=str(STATIC_DIR)),
        name="static",
    )

    return app
