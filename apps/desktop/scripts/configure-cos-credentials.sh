#!/usr/bin/env bash
# Store or verify the desktop release COS credentials in macOS Keychain.
set -euo pipefail

KEYCHAIN_SERVICE="${COS_KEYCHAIN_SERVICE:-com.deepseek-harness.desktop.release.cos}"
SECRET_ID_ACCOUNT="COS_SECRET_ID"
SECRET_KEY_ACCOUNT="COS_SECRET_KEY"

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

[ "$(uname -s)" = "Darwin" ] || fail "仅支持 macOS Keychain；其他平台请使用 COS_SECRET_ID / COS_SECRET_KEY 环境变量"
command -v security >/dev/null 2>&1 || fail "找不到 macOS security 命令"

if [ "${1:-}" = "--check" ]; then
  security find-generic-password -s "$KEYCHAIN_SERVICE" -a "$SECRET_ID_ACCOUNT" -w >/dev/null 2>&1 \
    || fail "Keychain 中没有 COS SecretId"
  security find-generic-password -s "$KEYCHAIN_SERVICE" -a "$SECRET_KEY_ACCOUNT" -w >/dev/null 2>&1 \
    || fail "Keychain 中没有 COS SecretKey"
  echo "COS 发布凭证已配置在 macOS Keychain。"
  exit 0
fi

[ "$#" -eq 0 ] || fail "用法：configure-cos-credentials.sh [--check]"

read -r -s -p "COS SecretId: " COS_SECRET_ID
printf '\n'
read -r -s -p "COS SecretKey: " COS_SECRET_KEY
printf '\n'
[ -n "$COS_SECRET_ID" ] || fail "SecretId 不能为空"
[ -n "$COS_SECRET_KEY" ] || fail "SecretKey 不能为空"

security add-generic-password -U -s "$KEYCHAIN_SERVICE" -a "$SECRET_ID_ACCOUNT" -w "$COS_SECRET_ID" >/dev/null
security add-generic-password -U -s "$KEYCHAIN_SERVICE" -a "$SECRET_KEY_ACCOUNT" -w "$COS_SECRET_KEY" >/dev/null
unset COS_SECRET_ID COS_SECRET_KEY

echo "COS 发布凭证已保存到 macOS Keychain；后续发布无需再次输入。"
