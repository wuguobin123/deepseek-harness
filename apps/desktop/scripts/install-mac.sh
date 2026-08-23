#!/usr/bin/env bash
# dsh Electron — macOS one-line installer.
#
# Usage (paste into Terminal):
#   bash -c "$(curl -fsSL https://wgb123-1257121815.cos.ap-beijing.myqcloud.com/install-mac.sh)"
#
# Flow: detect chip → download latest dmg → mount → copy to /Applications →
#       drop quarantine (sidesteps Gatekeeper's "已损坏" false positive on
#       ad-hoc-signed bundles) → launch.
set -euo pipefail

BASE_URL="${DSH_RELEASES_URL:-https://wgb123-1257121815.cos.ap-beijing.myqcloud.com}"
APP_NAME="DeepSeek Harness"
APP_PATH="/Applications/${APP_NAME}.app"

ARCH="$(uname -m)"
case "$ARCH" in
  arm64)  PKG="latest-mac-arm64.dmg" ;;
  x86_64) PKG="latest-mac-x64.dmg" ;;
  *) echo "不支持的架构: $ARCH" >&2; exit 1 ;;
esac

TMP_WORK="$(mktemp -d -t dsh-install.XXXXXX)"
trap 'hdiutil detach -quiet "$TMP_WORK/mnt" >/dev/null 2>&1 || true; rm -rf "$TMP_WORK"' EXIT
DMG="$TMP_WORK/installer.dmg"

echo "==> 下载 $PKG"
curl -fSL --progress-bar -o "$DMG" "$BASE_URL/$PKG"

echo "==> 挂载磁盘映像"
# 固定挂载点，避开 hdiutil 本地化输出（"/Volumes/xxx 2" 重名/多语言输出会解析错）。
MOUNT_DIR="$TMP_WORK/mnt"
mkdir -p "$MOUNT_DIR"
hdiutil attach -nobrowse -readonly -mountpoint "$MOUNT_DIR" "$DMG" >/dev/null
[ -d "$MOUNT_DIR/$APP_NAME.app" ] || { echo "dmg 中未找到 $APP_NAME.app" >&2; exit 1; }

if [ -d "$APP_PATH" ]; then
  echo "==> 已存在旧版本，退出正在运行的实例并替换"
  osascript -e "tell application \"$APP_NAME\" to quit" >/dev/null 2>&1 || true
  sleep 1
  rm -rf "$APP_PATH"
fi

echo "==> 安装到 /Applications"
ditto "$MOUNT_DIR/$APP_NAME.app" "$APP_PATH"
hdiutil detach -quiet "$MOUNT_DIR" || true

# 关键：包是 adhoc 签名未公证，浏览器/curl 下载会带 quarantine，
# 不去除会被 Gatekeeper 误报"已损坏，无法打开"。
echo "==> 去除 quarantine 属性"
xattr -dr com.apple.quarantine "$APP_PATH"

echo "==> 启动 $APP_NAME"
open "$APP_PATH"
echo "安装完成。以后可直接从启动台打开「${APP_NAME}」。"