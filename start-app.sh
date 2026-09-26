#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8765}"
DIRECTORY="${DIRECTORY:-dist}"
BUILD="${BUILD:-1}"

if [[ "$BUILD" != "0" ]]; then
  echo "[Agentic Tasks] Building ${DIRECTORY} from src/taskmanager source..."
  python3 tooling/scripts/build-deploy.py
fi

echo "[Agentic Tasks] Starting writable runtime server"
echo "[Agentic Tasks] URL: http://${HOST}:${PORT}/"
echo "[Agentic Tasks] Press Ctrl+C to stop."

runtime_args=(
  --directory "$DIRECTORY"
  --host "$HOST"
  --port "$PORT"
)
if [[ -n "${RUNTIME_CONFIG:-}" ]]; then
  runtime_args+=(--runtime-config "$RUNTIME_CONFIG")
fi
exec python3 tooling/scripts/serve-runtime.py "${runtime_args[@]}"
