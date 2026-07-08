#!/usr/bin/env bash
set -euo pipefail

if test -d apps/desktop/src-tauri; then
  echo "active Tauri source directory must not exist" >&2
  exit 1
fi

set +e
rg -n \
  --glob '!scripts/verify-macos-package.sh' \
  --glob '!scripts/verify-architecture-guardrails.mjs' \
  "@tauri-apps|src-tauri|tauri dev" \
  Cargo.toml apps/desktop/package.json apps/desktop/src apps/desktop/scripts scripts .github/workflows
rg_status=$?
set -e

if [ "$rg_status" -eq 0 ]; then
  echo "active Tauri references found" >&2
  exit 1
fi

if [ "$rg_status" -ne 1 ]; then
  echo "active Tauri reference scan failed" >&2
  exit "$rg_status"
fi

test -f "workers/claude-agent/package.json"
test -f "crates/slei-daemon/src/services/worker_launch.rs"

echo "macOS package boundary verified"
