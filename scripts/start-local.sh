#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -x .venv-roadhealth/bin/python ]; then
  if command -v python3.12 >/dev/null 2>&1; then
    python3.12 -m venv .venv-roadhealth
  else
    python3 -m venv .venv-roadhealth
  fi
  .venv-roadhealth/bin/python -m pip install -r requirements-dev.txt
fi
if [ ! -d frontend/node_modules ]; then npm --prefix frontend ci; fi
npm --prefix frontend run build
printf '\nRoad Health (team frontend): http://127.0.0.1:8000\nAPI docs: http://127.0.0.1:8000/docs\nPress Ctrl+C to stop.\n\n'
exec .venv-roadhealth/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
