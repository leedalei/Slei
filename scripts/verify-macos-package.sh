#!/usr/bin/env bash
set -euo pipefail

if [ "${SLEI_VERIFY_MACOS_ARM64:-0}" = "1" ]; then
  host_os="$(uname -s)"
  host_machine="$(uname -m)"
  if [ "$host_os" != "Darwin" ] || [ "$host_machine" != "arm64" ]; then
    echo "macOS package dry-run requires an arm64 macOS runner; got $host_os/$host_machine. Use macos-15-xlarge or a self-hosted arm64 macOS runner." >&2
    exit 1
  fi
fi

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
test -f "apps/desktop/electron-builder.yml"
test -f "apps/desktop/build/icon.icns"
test -f "apps/desktop/build/entitlements.mac.plist"
test -x "apps/desktop/scripts/package-macos.sh"

rg -q '"package:mac": "scripts/package-macos.sh dmg zip"' apps/desktop/package.json || {
  echo "apps/desktop package.json missing package:mac script" >&2
  exit 1
}

rg -q '"version": "[0-9]+\.[0-9]+\.[0-9]+"' apps/desktop/package.json || {
  echo "apps/desktop package.json missing exact Electron app version" >&2
  exit 1
}

rg -q '"package:mac:dir": "scripts/package-macos.sh dir"' apps/desktop/package.json || {
  echo "apps/desktop package.json missing package:mac:dir script" >&2
  exit 1
}

rg -q '"prepare:package-resources": "node scripts/prepare-package-resources.mjs"' apps/desktop/package.json || {
  echo "apps/desktop package.json missing prepare:package-resources script" >&2
  exit 1
}

rg -q '^appId: ai\.slei\.desktop$' apps/desktop/electron-builder.yml || {
  echo "electron-builder.yml missing appId" >&2
  exit 1
}

rg -q '^productName: Slei$' apps/desktop/electron-builder.yml || {
  echo "electron-builder.yml missing productName" >&2
  exit 1
}

rg -q '^directories:$' apps/desktop/electron-builder.yml && rg -q '^  output: release$' apps/desktop/electron-builder.yml || {
  echo "electron-builder.yml missing directories.output" >&2
  exit 1
}

rg -q '^files:$' apps/desktop/electron-builder.yml || {
  echo "electron-builder.yml missing files config" >&2
  exit 1
}

rg -q '^  - dist/\*\*$' apps/desktop/electron-builder.yml || {
  echo "electron-builder.yml missing dist files entry" >&2
  exit 1
}

rg -q '^  - dist-electron/\*\*$' apps/desktop/electron-builder.yml || {
  echo "electron-builder.yml missing dist-electron files entry" >&2
  exit 1
}

rg -q '^  - package\.json$' apps/desktop/electron-builder.yml || {
  echo "electron-builder.yml missing package.json files entry" >&2
  exit 1
}

rg -q '^asar: true$' apps/desktop/electron-builder.yml || {
  echo "electron-builder.yml missing asar" >&2
  exit 1
}

rg -q '^  category: public\.app-category\.productivity$' apps/desktop/electron-builder.yml || {
  echo "electron-builder.yml missing mac category" >&2
  exit 1
}

rg -q '^  icon: build/icon\.icns$' apps/desktop/electron-builder.yml || {
  echo "electron-builder.yml missing mac icon" >&2
  exit 1
}

rg -q '^  hardenedRuntime: true$' apps/desktop/electron-builder.yml || {
  echo "electron-builder.yml missing hardenedRuntime" >&2
  exit 1
}

rg -q '^  entitlements: build/entitlements\.mac\.plist$' apps/desktop/electron-builder.yml || {
  echo "electron-builder.yml missing entitlements" >&2
  exit 1
}

rg -q '^  entitlementsInherit: build/entitlements\.mac\.plist$' apps/desktop/electron-builder.yml || {
  echo "electron-builder.yml missing entitlementsInherit" >&2
  exit 1
}

rg -q '^  - from: dist-native/darwin-arm64$' apps/desktop/electron-builder.yml || {
  echo "electron-builder.yml missing extraResources source" >&2
  exit 1
}

rg -q '^    to: native/darwin-arm64$' apps/desktop/electron-builder.yml || {
  echo "electron-builder.yml missing extraResources destination" >&2
  exit 1
}

rg -q '^    - dmg$' apps/desktop/electron-builder.yml || {
  echo "electron-builder.yml missing mac target dmg" >&2
  exit 1
}

rg -q '^    - zip$' apps/desktop/electron-builder.yml || {
  echo "electron-builder.yml missing mac target zip" >&2
  exit 1
}

rg -F -q 'artifactName: Slei-${version}-${arch}.${ext}' apps/desktop/electron-builder.yml || {
  echo "electron-builder.yml missing artifactName" >&2
  exit 1
}

echo "macOS package boundary verified"
