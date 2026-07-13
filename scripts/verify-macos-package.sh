#!/usr/bin/env bash
set -euo pipefail

if [ "${SLEI_VERIFY_MACOS_ARM64:-0}" = "1" ]; then
  host_os="$(uname -s)"
  host_machine="$(uname -m)"
  if [ "$host_os" != "Darwin" ] || [ "$host_machine" != "arm64" ]; then
    echo "macOS package dry-run requires an arm64 macOS runner; got $host_os/$host_machine. Use macos-15 or a self-hosted arm64 macOS runner." >&2
    exit 1
  fi
fi

if test -d apps/desktop/src-tauri; then
  echo "active Tauri source directory must not exist" >&2
  exit 1
fi

search_regex() {
  local pattern="$1"
  local file="$2"
  if command -v rg >/dev/null 2>&1; then
    rg -q "$pattern" "$file"
  else
    grep -E -q "$pattern" "$file"
  fi
}

search_fixed() {
  local pattern="$1"
  local file="$2"
  if command -v rg >/dev/null 2>&1; then
    rg -F -q "$pattern" "$file"
  else
    grep -F -q "$pattern" "$file"
  fi
}

scan_active_tauri_references() {
  local pattern="@tauri-apps|src-tauri|tauri dev"
  local paths=(
    Cargo.toml
    apps/desktop/package.json
    apps/desktop/src
    apps/desktop/scripts
    scripts
    .github/workflows
  )
  local scan_path

  for scan_path in "${paths[@]}"; do
    if [ ! -e "$scan_path" ]; then
      echo "active Tauri reference scan path missing: $scan_path" >&2
      return 2
    fi
  done

  if command -v rg >/dev/null 2>&1; then
    rg -n \
      --glob '!scripts/verify-macos-package.sh' \
      --glob '!scripts/verify-architecture-guardrails.mjs' \
      "$pattern" \
      "${paths[@]}"
    return
  fi

  local result=1
  local grep_status
  local file
  while IFS= read -r -d '' file; do
    grep -nE "$pattern" "$file"
    grep_status=$?
    if [ "$grep_status" -eq 0 ]; then
      result=0
    elif [ "$grep_status" -ne 1 ]; then
      return "$grep_status"
    fi
  done < <(
    find "${paths[@]}" \
      -type f \
      ! -path 'scripts/verify-macos-package.sh' \
      ! -path 'scripts/verify-architecture-guardrails.mjs' \
      -print0
  )
  return "$result"
}

set +e
scan_active_tauri_references
scan_status=$?
set -e

if [ "$scan_status" -eq 0 ]; then
  echo "active Tauri references found" >&2
  exit 1
fi

if [ "$scan_status" -ne 1 ]; then
  echo "active Tauri reference scan failed" >&2
  exit "$scan_status"
fi

test -f "workers/claude-agent/package.json"
test -f "crates/slei-daemon/src/services/worker_launch.rs"
test -f "apps/desktop/electron-builder.yml"
test -f "apps/desktop/build/icon.icns"
test -f "apps/desktop/build/entitlements.mac.plist"
test -x "apps/desktop/scripts/package-macos.sh"

search_regex '"package:mac": "scripts/package-macos.sh dmg zip"' apps/desktop/package.json || {
  echo "apps/desktop package.json missing package:mac script" >&2
  exit 1
}

search_regex '"version": "[0-9]+\.[0-9]+\.[0-9]+"' apps/desktop/package.json || {
  echo "apps/desktop package.json missing exact Electron app version" >&2
  exit 1
}

search_regex '"package:mac:dir": "scripts/package-macos.sh dir"' apps/desktop/package.json || {
  echo "apps/desktop package.json missing package:mac:dir script" >&2
  exit 1
}

search_regex '"prepare:package-resources": "node scripts/prepare-package-resources.mjs"' apps/desktop/package.json || {
  echo "apps/desktop package.json missing prepare:package-resources script" >&2
  exit 1
}

search_regex '^appId: ai\.slei\.desktop$' apps/desktop/electron-builder.yml || {
  echo "electron-builder.yml missing appId" >&2
  exit 1
}

search_regex '^productName: Slei$' apps/desktop/electron-builder.yml || {
  echo "electron-builder.yml missing productName" >&2
  exit 1
}

search_regex '^directories:$' apps/desktop/electron-builder.yml && search_regex '^  output: release$' apps/desktop/electron-builder.yml || {
  echo "electron-builder.yml missing directories.output" >&2
  exit 1
}

search_regex '^files:$' apps/desktop/electron-builder.yml || {
  echo "electron-builder.yml missing files config" >&2
  exit 1
}

search_regex '^  - dist/\*\*$' apps/desktop/electron-builder.yml || {
  echo "electron-builder.yml missing dist files entry" >&2
  exit 1
}

search_regex '^  - dist-electron/\*\*$' apps/desktop/electron-builder.yml || {
  echo "electron-builder.yml missing dist-electron files entry" >&2
  exit 1
}

search_regex '^  - package\.json$' apps/desktop/electron-builder.yml || {
  echo "electron-builder.yml missing package.json files entry" >&2
  exit 1
}

search_regex '^asar: true$' apps/desktop/electron-builder.yml || {
  echo "electron-builder.yml missing asar" >&2
  exit 1
}

search_regex '^  category: public\.app-category\.productivity$' apps/desktop/electron-builder.yml || {
  echo "electron-builder.yml missing mac category" >&2
  exit 1
}

search_regex '^  icon: build/icon\.icns$' apps/desktop/electron-builder.yml || {
  echo "electron-builder.yml missing mac icon" >&2
  exit 1
}

search_regex '^  hardenedRuntime: true$' apps/desktop/electron-builder.yml || {
  echo "electron-builder.yml missing hardenedRuntime" >&2
  exit 1
}

search_regex '^  entitlements: build/entitlements\.mac\.plist$' apps/desktop/electron-builder.yml || {
  echo "electron-builder.yml missing entitlements" >&2
  exit 1
}

search_regex '^  entitlementsInherit: build/entitlements\.mac\.plist$' apps/desktop/electron-builder.yml || {
  echo "electron-builder.yml missing entitlementsInherit" >&2
  exit 1
}

search_regex '^  - from: dist-native/darwin-arm64$' apps/desktop/electron-builder.yml || {
  echo "electron-builder.yml missing extraResources source" >&2
  exit 1
}

search_regex '^    to: native/darwin-arm64$' apps/desktop/electron-builder.yml || {
  echo "electron-builder.yml missing extraResources destination" >&2
  exit 1
}

search_regex '^    - dmg$' apps/desktop/electron-builder.yml || {
  echo "electron-builder.yml missing mac target dmg" >&2
  exit 1
}

search_regex '^    - zip$' apps/desktop/electron-builder.yml || {
  echo "electron-builder.yml missing mac target zip" >&2
  exit 1
}

search_fixed 'artifactName: Slei-${version}-${arch}.${ext}' apps/desktop/electron-builder.yml || {
  echo "electron-builder.yml missing artifactName" >&2
  exit 1
}

echo "macOS package boundary verified"
