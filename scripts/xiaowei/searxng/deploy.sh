#!/usr/bin/env bash
# Deploy the pinned, loopback-only SearXNG service used by Xiaowei when the
# DeepSeek search credential is absent. The generated secret and settings stay
# under /etc; the repository contains no deployment credential.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SETTINGS_DIR="/etc/dsh-xiaowei/searxng"
SECRET_PATH="${SETTINGS_DIR}/secret"
SETTINGS_PATH="${SETTINGS_DIR}/settings.yml"
TEMPLATE_PATH="${SCRIPT_DIR}/settings.template.yml"
SEARCH_PORT="${XIAOWEI_SEARXNG_PORT:-18081}"

if [[ ! "${SEARCH_PORT}" =~ ^[0-9]+$ ]] || (( SEARCH_PORT < 1 || SEARCH_PORT > 65535 )); then
  printf '[xiaowei-searxng] invalid XIAOWEI_SEARXNG_PORT: %s\n' "${SEARCH_PORT}" >&2
  exit 1
fi

install -d -m 700 "${SETTINGS_DIR}"
if [[ ! -s "${SECRET_PATH}" ]]; then
  umask 077
  openssl rand -hex 32 > "${SECRET_PATH}"
fi

secret="$(tr -d '\r\n' < "${SECRET_PATH}")"
if [[ ! "${secret}" =~ ^[0-9a-f]{64}$ ]]; then
  printf '[xiaowei-searxng] %s does not contain a 32-byte hex secret\n' "${SECRET_PATH}" >&2
  exit 1
fi

settings_tmp="$(mktemp "${SETTINGS_DIR}/settings.yml.XXXXXX")"
trap 'rm -f "${settings_tmp}"' EXIT
sed "s/__XIAOWEI_SEARXNG_SECRET__/${secret}/" "${TEMPLATE_PATH}" > "${settings_tmp}"
chmod 600 "${settings_tmp}"
mv "${settings_tmp}" "${SETTINGS_PATH}"
trap - EXIT

XIAOWEI_SEARXNG_PORT="${SEARCH_PORT}" docker compose --file "${SCRIPT_DIR}/compose.yml" up -d --pull missing --force-recreate

for attempt in 1 2 3 4 5 6; do
  response="$(mktemp)"
  if curl --max-time 20 -fsS \
    --data-urlencode 'q=DeepSeek Harness' \
    --data 'format=json' \
    "http://127.0.0.1:${SEARCH_PORT}/search" > "${response}" \
    && node -e 'const fs=require("node:fs");const value=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if(!Array.isArray(value.results)||value.results.length===0)process.exit(1)' "${response}"; then
    rm -f "${response}"
    printf '[xiaowei-searxng] JSON search probe passed on attempt %s\n' "${attempt}" >&2
    exit 0
  fi
  rm -f "${response}"
  printf '[xiaowei-searxng] JSON search probe failed on attempt %s/6\n' "${attempt}" >&2
  sleep 3
done

docker compose --file "${SCRIPT_DIR}/compose.yml" logs --tail 80 >&2
exit 1
