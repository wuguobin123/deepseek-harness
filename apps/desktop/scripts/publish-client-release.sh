#!/usr/bin/env bash
# dsh Electron desktop — publish built packages to the dsh-ops host.
#
# Two flows, both optional and gated by env/flag:
#   1. rsync every artifact + latest.json to $DEPLOY_SSH:$RELEASES_DIR
#      (served by nginx from the same socket as the dsh-ops HTTP API)
#   2. coscli upload of latest-mac-* / latest-win-* / latest-linux-* /
#      latest.json / install-mac.sh / install-win.bat to $COS_BUCKET
#
# latest.json is the manifest shape the in-app update-checker stub will
# eventually consume; the symlink aliases (latest-mac-arm64.dmg, etc.)
# give the install-mac.sh / install-win.bat one-liners stable URLs.
#
# Usage:
#   apps/desktop/scripts/publish-client-release.sh            # full publish (rsync + COS)
#   apps/desktop/scripts/publish-client-release.sh --dry-run  # print plan only
#   apps/desktop/scripts/publish-client-release.sh --skip-cos # rsync only
#
# COS credentials are resolved in this order:
#   1. COS_SECRET_ID / COS_SECRET_KEY environment variables (one-off override)
#   2. macOS Keychain entries configured by configure-cos-credentials.sh
# COSCLI still names the optional coscli binary path.
set -euo pipefail

DEPLOY_SSH="${DEPLOY_SSH:-root@119.45.252.25}"
RELEASES_DIR="${RELEASES_DIR:-/var/lib/xiaowei-workbench/releases}"
RELEASE_NOTES="${RELEASE_NOTES:-}"
COS_BUCKET="${COS_BUCKET:-wgb123-1257121815}"
COS_REGION="${COS_REGION:-ap-beijing}"
COS_KEYCHAIN_SERVICE="${COS_KEYCHAIN_SERVICE:-com.deepseek-harness.desktop.release.cos}"
DRY_RUN=0
SKIP_COS=0
for arg in "$@"; do
  case "$arg" in
    --dry-run)  DRY_RUN=1 ;;
    --skip-cos) SKIP_COS=1 ;;
    *) echo "未知参数: $arg" >&2; exit 2 ;;
  esac
done

step() { printf '\n\033[1;34m== %s ==\033[0m\n' "$*"; }
fail() { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

load_cos_credentials() {
  if [ -n "${COS_SECRET_ID:-}" ] || [ -n "${COS_SECRET_KEY:-}" ]; then
    { [ -n "${COS_SECRET_ID:-}" ] && [ -n "${COS_SECRET_KEY:-}" ]; } \
      || fail "COS_SECRET_ID 与 COS_SECRET_KEY 必须同时设置"
    return
  fi

  if [ "$(uname -s)" = "Darwin" ] && command -v security >/dev/null 2>&1; then
    COS_SECRET_ID="$(security find-generic-password \
      -s "$COS_KEYCHAIN_SERVICE" -a COS_SECRET_ID -w 2>/dev/null || true)"
    COS_SECRET_KEY="$(security find-generic-password \
      -s "$COS_KEYCHAIN_SERVICE" -a COS_SECRET_KEY -w 2>/dev/null || true)"
  fi

  { [ -n "${COS_SECRET_ID:-}" ] && [ -n "${COS_SECRET_KEY:-}" ]; } \
    || fail "没有可用的 COS 凭证；首次运行 scripts/configure-cos-credentials.sh，或临时设置 COS_SECRET_ID / COS_SECRET_KEY"
}

DESKTOP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$DESKTOP_DIR/../.." && pwd)"
cd "$DESKTOP_DIR"

VERSION="$(node -p "require('./package.json').version")"
[ -n "$VERSION" ] || fail "无法从 package.json 读取 version"

# electron-builder artifactName is ${productName}-${version}-${arch}.${ext}
PRODUCT="小薇"
MAC_ARM64_DMG="$(ls release/"${PRODUCT}-${VERSION}-arm64.dmg" 2>/dev/null | head -1 || true)"
MAC_X64_DMG="$(ls release/"${PRODUCT}-${VERSION}-x64.dmg" 2>/dev/null | head -1 || true)"
WIN_X64_EXE="$(ls release/"${PRODUCT}-${VERSION}-x64.exe" 2>/dev/null | head -1 || true)"
LINUX_X64_APPIMAGE="$(ls release/"${PRODUCT}-${VERSION}.AppImage" 2>/dev/null | head -1 || true)"

MISSING_PACKAGES=()
[ -n "$MAC_ARM64_DMG" ]      || MISSING_PACKAGES+=("mac-arm64")
[ -n "$MAC_X64_DMG" ]        || MISSING_PACKAGES+=("mac-x64")
[ -n "$WIN_X64_EXE" ]        || MISSING_PACKAGES+=("win-x64")
[ -n "$LINUX_X64_APPIMAGE" ] || MISSING_PACKAGES+=("linux-x64")
[ "${#MISSING_PACKAGES[@]}" -eq 0 ] \
  || fail "release/ 下版本 $VERSION 的四平台安装包不完整，缺少：${MISSING_PACKAGES[*]}（先跑 package-release.sh）"

PACKAGES=("$MAC_ARM64_DMG" "$MAC_X64_DMG" "$WIN_X64_EXE" "$LINUX_X64_APPIMAGE")
# 一键安装脚本随每次发布同步（去 quarantine / 绕过未签名 "已损坏" 误报）
[ -f scripts/install-mac.sh ]   && PACKAGES+=("scripts/install-mac.sh")
[ -f scripts/install-win.bat ]  && PACKAGES+=("scripts/install-win.bat")

step "生成 latest.json（version=${VERSION}）"
TMP_WORK="$(mktemp -d -t dsh-client-release.XXXXXX)"
trap 'rm -rf "$TMP_WORK"' EXIT
LATEST_JSON="$TMP_WORK/latest.json"
MAC_ARM64_DMG="$MAC_ARM64_DMG" MAC_X64_DMG="$MAC_X64_DMG" \
WIN_X64_EXE="$WIN_X64_EXE" LINUX_X64_APPIMAGE="$LINUX_X64_APPIMAGE" \
RELEASE_NOTES="$RELEASE_NOTES" \
node - "$VERSION" "$LATEST_JSON" <<'EOF'
const fs = require('node:fs');
const path = require('node:path');
const [version, out] = process.argv.slice(2);
const files = {};
const pick = (key, file) => { if (file) files[key] = './' + path.basename(file); };
pick('mac-arm64', process.env.MAC_ARM64_DMG);
pick('mac-x64', process.env.MAC_X64_DMG);
pick('win-x64', process.env.WIN_X64_EXE);
pick('linux-x64', process.env.LINUX_X64_APPIMAGE);
const manifest = { version, releasedAt: new Date().toISOString(), files };
if (process.env.RELEASE_NOTES) manifest.notes = process.env.RELEASE_NOTES;
fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n');
EOF
cat "$LATEST_JSON"

step "发布到 $DEPLOY_SSH:$RELEASES_DIR"
LINK_PAIRS=()
add_link() { LINK_PAIRS+=("$(basename "$1")|$2"); }
[ -n "$MAC_ARM64_DMG" ]      && add_link "$MAC_ARM64_DMG" "latest-mac-arm64.dmg"
[ -n "$MAC_X64_DMG" ]        && add_link "$MAC_X64_DMG" "latest-mac-x64.dmg"
[ -n "$WIN_X64_EXE" ]        && add_link "$WIN_X64_EXE" "latest-win-x64.exe"
[ -n "$LINUX_X64_APPIMAGE" ] && add_link "$LINUX_X64_APPIMAGE" "latest-linux-x64.AppImage"
LINK_CMDS=""
for pair in "${LINK_PAIRS[@]}"; do
  src="${pair%%|*}"; dst="${pair##*|}"
  LINK_CMDS+="ln -sf '$src' '$dst' && "
done
LINK_CMDS="${LINK_CMDS% && }"

if [ "$DRY_RUN" -eq 1 ]; then
  echo "[dry-run] ssh $DEPLOY_SSH 'mkdir -p $RELEASES_DIR'"
  echo "[dry-run] rsync -az ${PACKAGES[*]} $DEPLOY_SSH:$RELEASES_DIR/"
  echo "[dry-run] ssh $DEPLOY_SSH 'chmod 0644 $RELEASES_DIR/*'"
  echo "[dry-run] ssh $DEPLOY_SSH 'cd $RELEASES_DIR && $LINK_CMDS'"
  echo "[dry-run] rsync -az $LATEST_JSON $DEPLOY_SSH:$RELEASES_DIR/latest.json"
else
  SSH_OPTS="-o BatchMode=yes -o ConnectTimeout=8"
  ssh $SSH_OPTS "$DEPLOY_SSH" "mkdir -p '$RELEASES_DIR'" \
    || fail "无法 SSH 到 ${DEPLOY_SSH}（需免密或 ssh-agent）"
  rsync -az --progress "${PACKAGES[@]}" "$DEPLOY_SSH:$RELEASES_DIR/"
  ssh $SSH_OPTS "$DEPLOY_SSH" "chmod 0644 '$RELEASES_DIR'/*"
  if [ -n "$LINK_CMDS" ]; then
    ssh $SSH_OPTS "$DEPLOY_SSH" "cd '$RELEASES_DIR' && $LINK_CMDS" \
      || fail "固定别名软链创建失败"
  fi
  # Publish the manifest last so readers never observe a version whose
  # packages and stable aliases have not finished uploading.
  rsync -az "$LATEST_JSON" "$DEPLOY_SSH:$RELEASES_DIR/latest.json"
  ssh $SSH_OPTS "$DEPLOY_SSH" "chmod 0644 '$RELEASES_DIR/latest.json'"
  echo "已发布。验证：curl -fsS http://119.45.252.25:18080/releases/latest.json"
  echo "固定下载链接："
  for pair in "${LINK_PAIRS[@]}"; do echo "  /releases/${pair##*|}"; done
fi

if [ "$SKIP_COS" -eq 1 ]; then
  step "跳过腾讯云 COS（--skip-cos）"
else
  step "同步到腾讯云 COS [${COS_BUCKET} ${COS_REGION}]"
  COSCLI="${COSCLI:-$(command -v coscli || echo "$REPO_ROOT/.tools/coscli")}"
  COS_FILES=()
  for pair in "${LINK_PAIRS[@]}"; do
    src="${pair%%|*}"; dst="${pair##*|}"
    COS_FILES+=("release/$src|$src")
    COS_FILES+=("release/$src|$dst")
  done
  [ -f scripts/install-mac.sh ]  && COS_FILES+=("scripts/install-mac.sh|install-mac.sh")
  [ -f scripts/install-win.bat ] && COS_FILES+=("scripts/install-win.bat|install-win.bat")
  # Keep latest.json last: its versioned URLs and stable aliases must already
  # resolve when clients observe the new manifest.
  COS_FILES+=("$LATEST_JSON|latest.json")
  if [ "$DRY_RUN" -eq 1 ]; then
    for item in "${COS_FILES[@]}"; do
      echo "[dry-run] coscli cp ${item%%|*} cos://$COS_BUCKET/${item##*|}"
    done
  else
    [ -x "$COSCLI" ] || fail "coscli 不可用：${COSCLI}（下载到 .tools/ 或显式 --skip-cos）"
    load_cos_credentials
    for item in "${COS_FILES[@]}"; do
      "$COSCLI" cp "${item%%|*}" "cos://$COS_BUCKET/${item##*|}" \
        -i "$COS_SECRET_ID" -k "$COS_SECRET_KEY" \
        -e "cos.$COS_REGION.myqcloud.com"
    done
    echo "COS 下载链接："
    for item in "${COS_FILES[@]}"; do
      echo "  https://$COS_BUCKET.cos.$COS_REGION.myqcloud.com/${item##*|}"
    done
  fi
fi
