# ============================================================
# === NOTES PERSISTENCE ===
# ============================================================
# Notes are saved AI outputs. The frontend always pushes the COMPLETE
# notes array on every change; we just write it to disk verbatim.

import json
from typing import Any, List

from fastapi import APIRouter

from app.config import NOTES_FILE

router = APIRouter()


@router.get("/notes")
def get_notes():
    """Load notes from disk. Returns empty list if file doesn't exist."""
    try:
        if NOTES_FILE.exists():
            return json.loads(NOTES_FILE.read_text(encoding="utf-8"))
        return []
    except Exception:
        return []


@router.post("/notes")
def save_notes(notes: List[Any]):
    """Persist the full notes array to disk. Frontend sends the complete array."""
    try:
        NOTES_FILE.write_text(
            json.dumps(notes, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}
