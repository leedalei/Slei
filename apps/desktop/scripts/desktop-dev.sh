#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DESKTOP_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
REPO_ROOT=$(CDPATH= cd -- "$DESKTOP_ROOT/../.." && pwd)
VITE_PID=""

cleanup() {
  if [ -n "$VITE_PID" ] && kill -0 "$VITE_PID" 2>/dev/null; then
    kill "$VITE_PID" 2>/dev/null || true
    wait "$VITE_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

cd "$REPO_ROOT"
pnpm --filter @slei/claude-agent build
cargo build -p slei-cli
cargo build -p slei-daemon

cd "$DESKTOP_ROOT"
pnpm dev &
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
electron dist-electron/main.js
