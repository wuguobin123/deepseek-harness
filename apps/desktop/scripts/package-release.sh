#!/usr/bin/env bash
# 桌面端发布打包：构建 → 验证 → 按平台打包（mac dmg / Windows nsis exe）。
# 用法：
#   scripts/package-release.sh              # mac(arm64) + Windows(x64) 全量
#   scripts/package-release.sh --mac        # 仅 mac arm64 dmg
#   scripts/package-release.sh --mac:x64    # 仅 mac x64 dmg
#   scripts/package-release.sh --win        # 仅 Windows nsis exe
#   scripts/package-release.sh --win --skip-probe   # 跳过运行时探针（无后端时）
# 环境变量：
#   PROBE_BASE_URL   探针登录的后端地址，默认 http://127.0.0.1:8000
#   SKIP_E2E=1       跳过 Playwright e2e 对比（默认跑；该套件存在历史基线失败，
#                    只做"失败集不扩大"判断，不要求全绿）
set -euo pipefail

DESKTOP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$DESKTOP_DIR/../.." && pwd)"

PLATFORMS=()
SKIP_PROBE=0
SKIP_E2E="${SKIP_E2E:-0}"
for arg in "$@"; do
  case "$arg" in
    --mac) PLATFORMS+=(mac) ;;
    --mac:x64) PLATFORMS+=(mac:x64) ;;
    --win) PLATFORMS+=(win) ;;
    --skip-probe) SKIP_PROBE=1 ;;
    --skip-e2e) SKIP_E2E=1 ;;
    *) echo "未知参数: $arg" >&2; exit 2 ;;
  esac
done
if [ "${#PLATFORMS[@]}" -eq 0 ]; then PLATFORMS=(mac win); fi

echo "==> [1/4] 构建 main/preload/renderer"
cd "$DESKTOP_DIR"
npm run build

echo "==> [2/4] 静态验证：typecheck + vitest"
npm run typecheck
npx vitest run

if [ "$SKIP_E2E" != "1" ]; then
  echo "==> [3/4] Playwright e2e（基线对比：失败集不得扩大）"
  BASELINE_FILE="$DESKTOP_DIR/scripts/e2e-baseline-failures.txt"
  RESULT_JSON="$(mktemp -t pw-release)"
  set +e
  npx playwright test --config playwright.config.ts --reporter=json > "$RESULT_JSON" 2>/dev/null
  set -e
  python3 - "$RESULT_JSON" "$BASELINE_FILE" <<'PY'
import json, sys
result, baseline_file = sys.argv[1], sys.argv[2]
d = json.load(open(result))
failed = sorted(
    spec["title"]
    for s in d["suites"]
    for spec in s.get("specs", [])
    for t in spec.get("tests", [])
    if t.get("status") != "expected"
)
try:
    baseline = sorted(x for x in open(baseline_file).read().splitlines() if x.strip())
except FileNotFoundError:
    baseline = []
new_failures = [f for f in failed if f not in baseline]
print(f"    失败 {len(failed)} 个（基线 {len(baseline)} 个）")
if new_failures:
    print("    新增失败（阻断发布）：")
    for f in new_failures:
        print(f"      - {f}")
    sys.exit(1)
print("    无新增失败，通过")
PY
else
  echo "==> [3/4] 跳过 Playwright e2e（SKIP_E2E=1）"
fi

if [ "$SKIP_PROBE" != "1" ]; then
  echo "==> [4/4] 运行时探针（真实 Electron + ${PROBE_BASE_URL:-http://127.0.0.1:8000}，逐 tab 取证）"
  PROBE_USER_DATA="$(mktemp -d /tmp/workbench-release-probe-XXXX)" node scripts/probe-nav-tabs.mjs
else
  echo "==> [4/4] 跳过运行时探针（--skip-probe）"
fi

for platform in "${PLATFORMS[@]}"; do
  case "$platform" in
    mac)     echo "==> 打包 mac arm64 dmg";   npm run package:mac ;;
    mac:x64) echo "==> 打包 mac x64 dmg";     npm run package:mac:x64 ;;
    win)     echo "==> 打包 Windows nsis exe（mac 上交叉构建，electron-builder 自带 makensis）"; npm run package:win ;;
  esac
done

echo ""
echo "==> 产物："
ls -lh "$DESKTOP_DIR/release/"*.{dmg,exe} 2>/dev/null || true
