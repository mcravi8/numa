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
# Homebrew python3.11 whose `uvicorn` shebang already points there.
if [ -x /opt/homebrew/bin/uvicorn ]; then
  UVICORN="/opt/homebrew/bin/uvicorn"
  START=("$UVICORN" main:app --port 8000 --host 127.0.0.1)
else
  START=(python3 -m uvicorn main:app --port 8000 --host 127.0.0.1)
fi

# Start the backend (silently, in background)
nohup "${START[@]}" >> logs/backend.log 2>&1 &

echo "Research Terminal backend started on http://localhost:8000"
echo "PID: $!"
echo $! > .backend.pid
