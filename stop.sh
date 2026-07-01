#!/bin/bash
if [ -f .backend.pid ]; then
  kill $(cat .backend.pid) 2>/dev/null
  rm .backend.pid
  echo "Research Terminal backend stopped"
else
  echo "No PID file found"
fi
