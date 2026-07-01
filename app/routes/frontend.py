# ============================================================
# === FRONTEND + PWA STATIC SERVING ===
# ============================================================
# Serve the SPA and PWA assets over HTTP. PWA manifests and service
# workers require HTTP origins, not file://, so the frontend is now
# served from here instead of being opened directly.
# NOTE: explicit routes must be defined BEFORE the catch-all static
# mount registered by create_app() (route order matters in FastAPI).

from fastapi import APIRouter
from fastapi.responses import FileResponse

from app.config import STATIC_DIR

router = APIRouter()


@router.get("/")
def serve_frontend():
    """Serve the main HTML file."""
    return FileResponse(STATIC_DIR / "index.html")


@router.get("/manifest.json")
def serve_manifest():
    return FileResponse(
        STATIC_DIR / "manifest.json",
        media_type="application/manifest+json",
    )


@router.get("/sw.js")
def serve_sw():
    return FileResponse(
        STATIC_DIR / "sw.js",
        media_type="application/javascript",
    )


@router.get("/icon-192.png")
def serve_icon_192():
    return FileResponse(STATIC_DIR / "icon-192.png")


@router.get("/icon-512.png")
def serve_icon_512():
    return FileResponse(STATIC_DIR / "icon-512.png")
