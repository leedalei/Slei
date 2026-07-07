#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DESKTOP_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
REPO_ROOT=$(CDPATH= cd -- "$DESKTOP_ROOT/../.." && pwd)
VITE_PID=""
DAEMON_WAS_FREE="0"
DAEMON_PID_FILE="${TMPDIR:-/tmp}/slei-desktop-daemon-pid.$$"
DAEMON_WATCHER_PID=""
ELECTRON_PID=""
CLEANED_UP="0"

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

list_daemon_listener_pids() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:4319 -sTCP:LISTEN -Fp 2>/dev/null | sed -n 's/^p//p' || true
  fi
}

process_cwd_matches_repo() {
  pid="$1"
  cwd=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1)
  [ "$cwd" = "$REPO_ROOT" ]
}

daemon_pid_is_owned_listener() {
  pid="$1"
  if [ -z "$pid" ] || ! process_cwd_matches_repo "$pid"; then
    return 1
  fi

  for listener_pid in $(list_daemon_listener_pids); do
    if [ "$listener_pid" = "$pid" ]; then
      return 0
    fi
  done

  return 1
}

record_owned_daemon_pid() {
  if [ "$DAEMON_WAS_FREE" != "1" ]; then
    return
  fi

  (
    attempts=0
    while [ "$attempts" -lt 600 ]; do
      for daemon_pid in $(list_daemon_listener_pids); do
        if process_cwd_matches_repo "$daemon_pid"; then
          printf '%s\n' "$daemon_pid" > "$DAEMON_PID_FILE"
          exit 0
        fi
      done
      attempts=$((attempts + 1))
      sleep 0.1
    done
  ) &
  DAEMON_WATCHER_PID=$!
}

cleanup_owned_daemon() {
  if [ "$DAEMON_WAS_FREE" = "1" ]; then
    if [ -n "$DAEMON_WATCHER_PID" ]; then
      kill "$DAEMON_WATCHER_PID" 2>/dev/null || true
      wait "$DAEMON_WATCHER_PID" 2>/dev/null || true
    fi

    daemon_pid=$(sed -n '1p' "$DAEMON_PID_FILE" 2>/dev/null || true)
    if daemon_pid_is_owned_listener "$daemon_pid"; then
      terminate_process_tree "$daemon_pid"
    fi
    pkill -f "$REPO_ROOT/workers/claude-agent" 2>/dev/null || true

    attempts=0
    while daemon_pid_is_owned_listener "$daemon_pid" \
      || pgrep -f "$REPO_ROOT/workers/claude-agent" >/dev/null 2>&1; do
      attempts=$((attempts + 1))
      if [ "$attempts" -ge 20 ]; then
        if daemon_pid_is_owned_listener "$daemon_pid"; then
          kill -KILL "$daemon_pid" 2>/dev/null || true
        fi
        pkill -KILL -f "$REPO_ROOT/workers/claude-agent" 2>/dev/null || true
        return
      fi
      sleep 0.1
    done
  fi
}

cleanup() {
  if [ "$CLEANED_UP" = "1" ]; then
    return
  fi
  CLEANED_UP="1"

  if [ -n "$ELECTRON_PID" ]; then
    terminate_process_tree "$ELECTRON_PID"
  fi
  if [ -n "$VITE_PID" ]; then
    terminate_process_tree "$VITE_PID"
  fi
  cleanup_owned_daemon
  rm -f "$DAEMON_PID_FILE"
}

trap cleanup EXIT
trap 'cleanup; exit 130' INT TERM

cd "$REPO_ROOT"
pnpm --filter @slei/claude-agent build
cargo build -p slei-cli
cargo build -p slei-daemon

cd "$DESKTOP_ROOT"
node "$DESKTOP_ROOT/node_modules/vite/bin/vite.js" --host 127.0.0.1 --port 1420 --strictPort &
VITE_PID=$!

attempts=0
while true; do
  if ! kill -0 "$VITE_PID" 2>/dev/null; then
    wait "$VITE_PID" 2>/dev/null || true
    echo "[slei-desktop] Vite exited before becoming ready" >&2
    exit 1
  fi
  if nc -z 127.0.0.1 1420 2>/dev/null; then
    sleep 0.2
    if ! kill -0 "$VITE_PID" 2>/dev/null; then
      wait "$VITE_PID" 2>/dev/null || true
      echo "[slei-desktop] Vite exited after port 1420 became available" >&2
      exit 1
    fi
    break
  fi
  attempts=$((attempts + 1))
  if [ "$attempts" -ge 300 ]; then
    echo "[slei-desktop] timed out waiting for Vite" >&2
    exit 1
  fi
  sleep 0.1
done

pnpm build:electron
if ! nc -z 127.0.0.1 4319 2>/dev/null; then
  DAEMON_WAS_FREE="1"
fi
electron dist-electron/electron/main.js &
ELECTRON_PID=$!
record_owned_daemon_pid
wait "$ELECTRON_PID"
