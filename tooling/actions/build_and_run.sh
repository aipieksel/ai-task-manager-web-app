#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

INSTALL_PATH="${AGENTIC_TASK_MANAGER_INSTALL_PATH:-$HOME/Applications/Agentic AI Projects Task Manager.app}"
BUILD_PATH="${AGENTIC_TASK_MANAGER_BUILD_PATH:-$ROOT_DIR/build/release/mac-arm64/Agentic AI Projects Task Manager.app}"
VERIFY=0
RUN_TESTS=0

for arg in "$@"; do
  case "$arg" in
    --verify) VERIFY=1 ;;
    --test|--tests) RUN_TESTS=1 ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

# Build first; the currently installed app can keep running while the new bundle is produced.
if [[ "$RUN_TESTS" == "1" ]]; then
  npm test
fi

npm run electron:pack

if [[ ! -d "$BUILD_PATH" ]]; then
  echo "Expected packaged app was not found: $BUILD_PATH" >&2
  exit 1
fi

# Only close the public app when we are ready to replace its installed bundle.
/usr/bin/osascript -e 'tell application "Agentic AI Projects Task Manager" to quit' >/dev/null 2>&1 || true
for _ in {1..20}; do
  if ! pgrep -fl "$INSTALL_PATH/Contents/" >/dev/null; then
    break
  fi
  sleep 0.5
done
if pgrep -fl "$INSTALL_PATH/Contents/" >/dev/null; then
  echo "The public task manager is still running after a graceful quit request; forcing only its installed processes closed."
  pgrep -fl "$INSTALL_PATH/Contents/" | awk '{print $1}' | while read -r pid; do
    [[ -n "$pid" ]] && kill "$pid" >/dev/null 2>&1 || true
  done
  sleep 1
fi
if pgrep -fl "$INSTALL_PATH/Contents/" >/dev/null; then
  echo "Public task manager helper processes are still running; force-killing only the installed public app processes."
  pgrep -fl "$INSTALL_PATH/Contents/" | awk '{print $1}' | while read -r pid; do
    [[ -n "$pid" ]] && kill -9 "$pid" >/dev/null 2>&1 || true
  done
  sleep 1
fi

mkdir -p "$(dirname "$INSTALL_PATH")"
if [[ -d "$INSTALL_PATH" ]]; then
  rm -rf "$INSTALL_PATH"
fi
cp -R "$BUILD_PATH" "$INSTALL_PATH"
# Remove the temporary packaged .app so LaunchServices does not find duplicate public bundles.
rm -rf "$(dirname "$(dirname "$BUILD_PATH")")"
/usr/bin/xattr -dr com.apple.quarantine "$INSTALL_PATH" >/dev/null 2>&1 || true
/usr/bin/open "$INSTALL_PATH"

if [[ "$VERIFY" == "1" ]]; then
  sleep 3
  pgrep -fl "$INSTALL_PATH/Contents/MacOS/Agentic AI Projects Task Manager" >/dev/null
  echo "Agentic AI Projects Task Manager rebuilt, installed, and running: $INSTALL_PATH"
else
  echo "Agentic AI Projects Task Manager rebuilt and opened: $INSTALL_PATH"
fi
