#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
PYTHON_BIN="${PYTHON:-$(command -v python3 || command -v python)}"

"$PYTHON_BIN" tooling/scripts/build-deploy.py

for file in src/taskmanager/sw.js $(find src/taskmanager/js -name "*.js" | sort); do
  node --check "$file"
done

node tooling/qa/parser_writer.test.mjs
node tooling/qa/project_setup.test.mjs
node tooling/qa/filesystem.test.mjs
node tooling/qa/public_identity.test.mjs
"$PYTHON_BIN" tooling/qa/automation_assignments.test.py
"$PYTHON_BIN" tooling/qa/demo_fixture.test.py
"$PYTHON_BIN" tooling/qa/python_bootstrap.test.py
"$PYTHON_BIN" tooling/qa/static_audit.py
"$PYTHON_BIN" tooling/qa/public_release_audit.py

if "$PYTHON_BIN" - <<'PY' >/dev/null 2>&1
import playwright  # noqa: F401
PY
then
  : "${CHROMIUM_EXECUTABLE:=/usr/bin/chromium}"
  CHROMIUM_EXECUTABLE="$CHROMIUM_EXECUTABLE" TARGET_DIR=src/taskmanager "$PYTHON_BIN" tooling/qa/browser_smoke.py
  CHROMIUM_EXECUTABLE="$CHROMIUM_EXECUTABLE" TARGET_DIR=dist "$PYTHON_BIN" tooling/qa/browser_smoke.py
  CHROMIUM_EXECUTABLE="$CHROMIUM_EXECUTABLE" TARGET_DIR=src/taskmanager "$PYTHON_BIN" tooling/qa/browser_filesystem_e2e.py
  CHROMIUM_EXECUTABLE="$CHROMIUM_EXECUTABLE" TARGET_DIR=dist "$PYTHON_BIN" tooling/qa/browser_filesystem_e2e.py
  CHROMIUM_EXECUTABLE="$CHROMIUM_EXECUTABLE" TARGET_DIR=src/taskmanager "$PYTHON_BIN" tooling/qa/project_onboarding_e2e.py
  CHROMIUM_EXECUTABLE="$CHROMIUM_EXECUTABLE" TARGET_DIR=dist "$PYTHON_BIN" tooling/qa/project_onboarding_e2e.py
else
  echo "Playwright unavailable; browser checks skipped." >&2
  exit 2
fi
