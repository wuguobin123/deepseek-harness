#!/usr/bin/env bash
# dsh Electron desktop — build & package release.
#
# Pipeline:
#   1. install dependencies
#   2. typecheck
#   3. unit tests (Vitest)
#   4. renderer smoke build (Vite)
#   5. package every requested platform target
#
# Usage:
#   scripts/package-release.sh                # mac arm64 + mac x64 + Linux AppImage + Windows NSIS
#   scripts/package-release.sh --mac          # only mac arm64 DMG
#   scripts/package-release.sh --mac:x64      # only mac x64 DMG
#   scripts/package-release.sh --linux        # only Linux AppImage
#   scripts/package-release.sh --win          # only Windows NSIS
#
# Environment overrides:
#   SKIP_TESTS=1   skip vitest (tests still need to run in CI before merging)
#   SKIP_INSTALL=1 skip pnpm install (for inside-CI where deps are already there)
#   WORKBENCH_API_BASE_URL  bake a non-default apiBaseUrl into product-config.json
set -euo pipefail

DESKTOP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$DESKTOP_DIR/../.." && pwd)"

PLATFORMS=()
for arg in "$@"; do
  case "$arg" in
    --mac)     PLATFORMS+=(mac) ;;
    --mac:x64) PLATFORMS+=(mac:x64) ;;
    --linux)   PLATFORMS+=(linux) ;;
    --win)     PLATFORMS+=(win) ;;
    *) echo "未知参数: $arg" >&2; exit 2 ;;
  esac
done
[ "${#PLATFORMS[@]}" -gt 0 ] || PLATFORMS=(mac mac:x64 linux win)

step() { printf '\n\033[1;34m== %s ==\033[0m\n' "$*"; }
fail() { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

cd "$DESKTOP_DIR"

if [ "${SKIP_INSTALL:-0}" != "1" ]; then
  step "[1/5] pnpm install"
  pnpm install --prefer-offline --frozen-lockfile=false
else
  step "[1/5] skip pnpm install (SKIP_INSTALL=1)"
fi

step "[2/5] tsc --noEmit"
pnpm run typecheck

if [ "${SKIP_TESTS:-0}" != "1" ]; then
  step "[3/5] vitest run"
  pnpm run test
else
  step "[3/5] skip vitest (SKIP_TESTS=1)"
fi

step "[4/5] vite build (renderer)"
pnpm run build:renderer

step "[5/5] electron-builder package"
for platform in "${PLATFORMS[@]}"; do
  case "$platform" in
    mac)     echo "==> mac arm64 dmg";  pnpm run package:mac ;;
    mac:x64) echo "==> mac x64 dmg";    pnpm run package:mac:x64 ;;
    linux)   echo "==> Linux AppImage"; pnpm run package:linux ;;
    win)     echo "==> Windows NSIS";   pnpm run package:win ;;
  esac
done

printf '\n\033[1;32m== 产物 ==\033[0m\n'
ls -lh "$DESKTOP_DIR/release/" 2>/dev/null | grep -E '\.(dmg|exe|AppImage)$' || true