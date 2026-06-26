#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DESKTOP_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
REPO_ROOT=$(CDPATH= cd -- "$DESKTOP_ROOT/../.." && pwd)
DAEMON_PID=""

cleanup() {
  if [ -n "$DAEMON_PID" ] && kill -0 "$DAEMON_PID" 2>/dev/null; then
    kill "$DAEMON_PID" 2>/dev/null || true
    wait "$DAEMON_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

cd "$REPO_ROOT"
pnpm --filter @slei/claude-agent build
cargo build -p slei-cli
cargo build -p slei-daemon

if nc -z 127.0.0.1 4319 2>/dev/null; then
  echo "[slei-desktop] local daemon already listening on 127.0.0.1:4319"
else
  echo "[slei-desktop] starting local daemon on 127.0.0.1:4319"
  cargo run -p slei-daemon &
  DAEMON_PID=$!
  attempts=0
  until nc -z 127.0.0.1 4319 2>/dev/null; do
    if ! kill -0 "$DAEMON_PID" 2>/dev/null; then
      wait "$DAEMON_PID" 2>/dev/null || true
      echo "[slei-desktop] local daemon exited before becoming ready" >&2
      exit 1
    fi
    attempts=$((attempts + 1))
    if [ "$attempts" -ge 300 ]; then
      echo "[slei-desktop] timed out waiting for local daemon" >&2
      exit 1
    fi
    sleep 0.1
  done
fi

cd "$DESKTOP_ROOT"
tauri dev
