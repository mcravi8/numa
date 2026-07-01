#!/usr/bin/env python3
"""Entrypoint for the Research Terminal backend.

Launches uvicorn for the FastAPI app defined in main.py (`main:app`) on port
8000 — the programmatic equivalent of `uvicorn main:app --port 8000`. This is
the single command start.sh invokes; you can also run it directly:

    python run.py

Host, port, and reload default to 127.0.0.1:8000 with reload off, and can be
overridden via environment variables:

    HOST=0.0.0.0 PORT=8000 RELOAD=1 python run.py
"""
import os

import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host=os.getenv("HOST", "127.0.0.1"),
        port=int(os.getenv("PORT", "8000")),
        reload=os.getenv("RELOAD") == "1",
    )
