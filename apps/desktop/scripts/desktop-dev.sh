#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DESKTOP_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
REPO_ROOT=$(CDPATH= cd -- "$DESKTOP_ROOT/../.." && pwd)
VITE_PID=""

terminate_process_tree() {
  pid="$1"
  if ! kill -0 "$pid" 2>/dev/null; then
    return
  fi

  if command -v pgrep >/dev/null 2>&1; then
    for child_pid in $(pgrep -P "$pid" 2>/dev/null || true); do
      terminate_process_tree "$child_pid"
    done
  fi

  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
}

cleanup() {
  if [ -n "$VITE_PID" ]; then
    terminate_process_tree "$VITE_PID"
  fi
}

trap cleanup EXIT INT TERM

cd "$REPO_ROOT"
pnpm --filter @slei/claude-agent build
cargo build -p slei-cli
cargo build -p slei-daemon

cd "$DESKTOP_ROOT"
node "$DESKTOP_ROOT/node_modules/vite/bin/vite.js" --host 127.0.0.1 --port 1420 &
VITE_PID=$!

attempts=0
until nc -z 127.0.0.1 1420 2>/dev/null; do
  if ! kill -0 "$VITE_PID" 2>/dev/null; then
    wait "$VITE_PID" 2>/dev/null || true
    echo "[slei-desktop] Vite exited before becoming ready" >&2
    exit 1
  fi
  attempts=$((attempts + 1))
  if [ "$attempts" -ge 300 ]; then
    echo "[slei-desktop] timed out waiting for Vite" >&2
    exit 1
  fi
  sleep 0.1
done

pnpm build:electron
electron dist-electron/electron/main.js
