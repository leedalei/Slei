#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$DESKTOP_ROOT/../.." && pwd)"

usage() {
  echo "usage: scripts/package-macos.sh [dir|dmg|zip]..." >&2
}

PACKAGE_ARCH="${SLEI_PACKAGE_ARCH:-arm64}"
case "$PACKAGE_ARCH" in
  arm64)
    ;;
  x64|universal)
    echo "SLEI_PACKAGE_ARCH=$PACKAGE_ARCH is reserved for a later packaging task; only arm64 is supported now." >&2
    exit 1
    ;;
  *)
    echo "unsupported SLEI_PACKAGE_ARCH=$PACKAGE_ARCH; only arm64 is supported now." >&2
    exit 1
    ;;
esac

if [ "$#" -eq 0 ]; then
  usage
  exit 1
fi

targets=()
for target in "$@"; do
  case "$target" in
    dir|dmg|zip)
      targets+=("$target")
      ;;
    *)
      echo "unsupported macOS package target: $target" >&2
      usage
      exit 1
      ;;
  esac
done

cd "$DESKTOP_ROOT"

pnpm build
pnpm build:electron

cd "$REPO_ROOT"
cargo build --release -p slei-daemon -p slei-cli

cd "$DESKTOP_ROOT"
node scripts/bundle-claude-worker.mjs
node scripts/prepare-node-runtime.mjs
node scripts/prepare-package-resources.mjs --skip-build
node scripts/package-resource-check.mjs --root .

pnpm exec electron-builder --config electron-builder.yml --mac "${targets[@]}" --arm64
