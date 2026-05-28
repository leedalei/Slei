#!/usr/bin/env bash
set -euo pipefail

CONF="apps/desktop/src-tauri/tauri.conf.json"

test -f "$CONF"
grep -q '"productName": "Slei"' "$CONF"
grep -q '"active": true' "$CONF"
grep -q "connect-src ipc:" "$CONF"
if grep -q "server-url\\|api-key\\|cloud control" "$CONF"; then
  echo "cloud control marker found in Tauri config" >&2
  exit 1
fi

test -f "workers/claude-agent/package.json"
test -f "crates/slei-daemon/src/services/worker_launch.rs"

echo "macOS package boundary verified"
