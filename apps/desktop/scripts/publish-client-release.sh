#!/usr/bin/env bash
# 发布客户端安装包：
#   1) rsync 到生产 releases 目录（nginx /releases/，18080 裸 IP）——
#      服务客户端 API 同源的更新检查与更新下载（update-checker 强制同源）。
#   2) 同步到腾讯云 COS（公有读，HTTPS 默认域名）——对外唯一下载通道
#      （博客下载按钮、一键安装脚本）。
# 流程：读 package.json version → 扫描 release/ 产物 → 生成 latest.json →
#       rsync latest.json + 安装包到 $DEPLOY_SSH:$RELEASES_DIR →
#       以固定 latest-* 命名上传到 COS 桶根。
# 不进 package-release.sh 主流程，发版打包完成后显式执行：
#   apps/desktop/scripts/publish-client-release.sh            # 正式发布
#   apps/desktop/scripts/publish-client-release.sh --dry-run  # 只打印将执行的动作
#   apps/desktop/scripts/publish-client-release.sh --skip-cos # 只发服务器
# 可用环境变量覆盖：
#   DEPLOY_SSH    SSH 目标（默认 root@119.45.252.25，与 scripts/deploy_production.sh 一致）
#   RELEASES_DIR  远端 releases 目录（默认 /var/lib/xiaowei-workbench/releases）
#   RELEASE_NOTES 写入 latest.json 的 notes 字段（可选）
#   COS_SECRET_ID / COS_SECRET_KEY  腾讯云 CAM 子用户密钥（只需桶的读写权限）
#   COS_BUCKET / COS_REGION         目标桶（默认 wgb123-1257121815 / ap-beijing）
set -euo pipefail

DEPLOY_SSH="${DEPLOY_SSH:-root@119.45.252.25}"
RELEASES_DIR="${RELEASES_DIR:-/var/lib/xiaowei-workbench/releases}"
RELEASE_NOTES="${RELEASE_NOTES:-}"
COS_BUCKET="${COS_BUCKET:-wgb123-1257121815}"
COS_REGION="${COS_REGION:-ap-beijing}"
DRY_RUN=0
SKIP_COS=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --skip-cos) SKIP_COS=1 ;;
    *) echo "未知参数: $arg" >&2; exit 2 ;;
  esac
done

step() { printf '\n\033[1;34m== %s ==\033[0m\n' "$*"; }
fail() { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

DESKTOP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DESKTOP_DIR"

VERSION="$(node -p "require('./package.json').version")"
[ -n "$VERSION" ] || fail "无法从 package.json 读取 version"

# 按 electron-builder 的 artifactName（${productName}-${version}-${arch}.${ext}）匹配产物。
MAC_ARM64_DMG="$(ls release/*-"$VERSION"-arm64.dmg 2>/dev/null | head -1 || true)"
MAC_X64_DMG="$(ls release/*-"$VERSION"-x64.dmg 2>/dev/null | head -1 || true)"
WIN_X64_EXE="$(ls release/*-"$VERSION"-x64.exe 2>/dev/null | head -1 || true)"
LINUX_X64_APPIMAGE="$(ls release/*-"$VERSION".AppImage 2>/dev/null | head -1 || true)"

PACKAGES=()
[ -n "$MAC_ARM64_DMG" ] && PACKAGES+=("$MAC_ARM64_DMG")
[ -n "$MAC_X64_DMG" ] && PACKAGES+=("$MAC_X64_DMG")
[ -n "$WIN_X64_EXE" ] && PACKAGES+=("$WIN_X64_EXE")
[ -n "$LINUX_X64_APPIMAGE" ] && PACKAGES+=("$LINUX_X64_APPIMAGE")
[ "${#PACKAGES[@]}" -gt 0 ] || fail "release/ 下没有匹配版本 $VERSION 的安装包（先跑 package-release.sh 打包）"
# macOS 一键安装脚本随每次发布同步（去 quarantine，绕过"已损坏"误报）。
[ -f scripts/install-mac.sh ] && PACKAGES+=("scripts/install-mac.sh")
# Windows 一键安装脚本同样随发布同步（curl + 批处理；先卸载旧版再安装，
# 避开未签名包 "Failed to uninstall old application files" 与云镜对 PowerShell 下载执行的拦截）。
[ -f scripts/install-win.bat ] && PACKAGES+=("scripts/install-win.bat")

step "生成 latest.json（version=${VERSION}）"
# files 值为相对路径（原始文件名，含空格由客户端 resolve 时百分号编码）。
TMP_WORK="$(mktemp -d -t client-release.XXXXXX)"
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
# 固定别名（符号链接，不占额外磁盘）：对外下载链接永久不变，每次发版指向最新版。
LINK_PAIRS=()
add_link() { LINK_PAIRS+=("$(basename "$1")|$2"); }
[ -n "$MAC_ARM64_DMG" ] && add_link "$MAC_ARM64_DMG" "latest-mac-arm64.dmg"
[ -n "$MAC_X64_DMG" ] && add_link "$MAC_X64_DMG" "latest-mac-x64.dmg"
[ -n "$WIN_X64_EXE" ] && add_link "$WIN_X64_EXE" "latest-win-x64.exe"
[ -n "$LINUX_X64_APPIMAGE" ] && add_link "$LINUX_X64_APPIMAGE" "latest-linux-x64.AppImage"
LINK_CMDS=""
for pair in "${LINK_PAIRS[@]}"; do
  src="${pair%%|*}"; dst="${pair##*|}"
  LINK_CMDS+="ln -sf '$src' '$dst' && "
done
LINK_CMDS="${LINK_CMDS% && }"

if [ "$DRY_RUN" -eq 1 ]; then
  echo "[dry-run] ssh $DEPLOY_SSH 'mkdir -p $RELEASES_DIR'"
  echo "[dry-run] rsync -az $LATEST_JSON ${PACKAGES[*]} $DEPLOY_SSH:$RELEASES_DIR/latest.json + 安装包"
  echo "[dry-run] ssh $DEPLOY_SSH 'chmod 0644 $RELEASES_DIR/*'"
  echo "[dry-run] ssh $DEPLOY_SSH 'cd $RELEASES_DIR && $LINK_CMDS'"
else
  SSH_OPTS="-o BatchMode=yes -o ConnectTimeout=8"
  ssh $SSH_OPTS "$DEPLOY_SSH" "mkdir -p '$RELEASES_DIR'" \
    || fail "无法 SSH 到 ${DEPLOY_SSH}（需免密或 ssh-agent）"
  # 生产机 rsync 版本较老，不支持 --info=progress2，用 --progress。
  rsync -az --progress "$LATEST_JSON" "${PACKAGES[@]}" "$DEPLOY_SSH:$RELEASES_DIR/"
  ssh $SSH_OPTS "$DEPLOY_SSH" "chmod 0644 '$RELEASES_DIR'/*"
  if [ -n "$LINK_CMDS" ]; then
    ssh $SSH_OPTS "$DEPLOY_SSH" "cd '$RELEASES_DIR' && $LINK_CMDS" \
      || fail "固定别名软链创建失败"
  fi
  echo "已发布。验证：curl -fsS <服务地址>/releases/latest.json"
  echo "固定下载链接（永久指向最新版）："
  for pair in "${LINK_PAIRS[@]}"; do echo "  /releases/${pair##*|}"; done
fi

# ---- 腾讯云 COS：国内 HTTPS 下载主通道 ----
# 桶为公有读私有写，默认域名自带 HTTPS 且无需 ICP 备案。密钥走环境变量，
# 不写 coscli 配置文件（-i/-k/-e 逐命令传入），不会落盘到 ~/.cos.yaml。
if [ "$SKIP_COS" -eq 1 ]; then
  step "跳过腾讯云 COS（--skip-cos）"
else
  step "同步到腾讯云 COS [${COS_BUCKET} ${COS_REGION}]"
  COSCLI="${COSCLI:-$(command -v coscli || echo "$DESKTOP_DIR/../../.tools/coscli")}"
  COS_FILES=()
  for pair in "${LINK_PAIRS[@]}"; do
    src="${pair%%|*}"; dst="${pair##*|}"
    COS_FILES+=("release/$src|$dst")
  done
  COS_FILES+=("$LATEST_JSON|latest.json")
  [ -f scripts/install-mac.sh ] && COS_FILES+=("scripts/install-mac.sh|install-mac.sh")
  [ -f scripts/install-win.bat ] && COS_FILES+=("scripts/install-win.bat|install-win.bat")
  if [ "$DRY_RUN" -eq 1 ]; then
    for item in "${COS_FILES[@]}"; do
      echo "[dry-run] coscli cp ${item%%|*} cos://$COS_BUCKET/${item##*|}"
    done
  else
    [ -x "$COSCLI" ] || fail "coscli 不可用：${COSCLI}（下载到 .tools/ 或显式 --skip-cos）"
    { [ -n "${COS_SECRET_ID:-}" ] && [ -n "${COS_SECRET_KEY:-}" ]; } \
      || fail "缺少 COS_SECRET_ID / COS_SECRET_KEY（或显式 --skip-cos）"
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
