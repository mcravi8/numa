#!/bin/bash
# Research Terminal — auto-start script
# Add to Mac Login Items: System Settings → General → Login Items → +

# Navigate to the project directory
cd "$(dirname "$0")"

# Activate the right Python environment if using conda or venv
# Uncomment and adjust one of these:
# source ~/.zshrc  # loads conda/pyenv
# conda activate quant  # if using conda quant env

mkdir -p logs

# Pick the interpreter that actually has the app's deps. On this machine the
# default `python3` is 3.13 (no fastapi/uvicorn); the runtime lives on the
# Homebrew python3.11. run.py imports uvicorn to launch main:app, so it must
# run under that interpreter. Prefer the exact python behind the installed
# `uvicorn` console script (its shebang is guaranteed to have the deps), then
# python3.11, then plain python3.
PYTHON=""
if [ -x /opt/homebrew/bin/uvicorn ]; then
  PYTHON="$(sed -n '1s/^#!//p' /opt/homebrew/bin/uvicorn)"
fi
if [ -z "$PYTHON" ] || [ ! -x "$PYTHON" ]; then
  if command -v python3.11 >/dev/null 2>&1; then
    PYTHON="$(command -v python3.11)"
  else
    PYTHON="python3"
  fi
fi

# Start the backend (silently, in background) via the run.py entrypoint.
nohup "$PYTHON" run.py >> logs/backend.log 2>&1 &

echo "Research Terminal backend started on http://localhost:8000"
echo "PID: $!"
echo $! > .backend.pid
