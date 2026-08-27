#!/usr/bin/env bash
# scripts/deploy_xiaowei.sh — deploy the dsh-xiaowei profile to production.
#
# Mirrors the 6-gate flow of scripts/deploy_dsh.sh but for the xiaowei
# multi-user bundle. Six gates; any failure aborts:
#   1. Pre-flight: git clean + SSH + local typecheck.
#   2. Remote backup: snapshot the live /opt/dsh-xiaowei tree.
#   3. Code sync: rsync the built artifacts + cordis.patches + scripts.
#   4. Install: pnpm install on remote + write nginx reverse-proxy snippet.
#   5. Restart: systemctl restart dsh-xiaowei + nginx reload.
#   6. Health: curl http://127.0.0.1:18080/health (through nginx) AND
#      curl http://127.0.0.1:18000/health (direct loopback), 5 retries each.
#
# The nginx snippet at /etc/nginx/conf.d/dsh-xiaowei.conf reverse-proxies
# public :18080 → loopback :18000. Xiaowei's `trustedHosts` cordis fence
# recognises both the public-facing hostname (defaults to the public IP)
# AND loopback, so desktop clients that connect through nginx are trusted
# on the same authority check as direct loopback callers.
#
# Usage:
#   scripts/deploy_xiaowei.sh                # deploy
#   scripts/deploy_xiaowei.sh --dry-run      # preview the sync + remote commands
#
# Environment overrides:
#   DEPLOY_SSH                    default root@119.45.252.25
#   DEPLOY_DIR                    default /opt/dsh-xiaowei
#   DSH_XIAOWEI_PORT            default 18000 (loopback bind)
#   DSH_XIAOWEI_PUBLIC_PORT     default 18080 (nginx listen)
#   XIAOWEI_SEARXNG_PORT         default 18081 (loopback-only search backend)
#   DSH_HOME_DIR                  default /var/lib/dsh-xiaowei
#   XIAOWEI_TRUSTED_HOSTS_EXTRA default empty (comma-separated extras to
#                                  append to the auto-derived public list;
#                                  loopback is always included)
#   XIAOWEI_ADMIN_EMAIL        optional (empty disables admin bootstrap)
#   XIAOWEI_ADMIN_PASSWORD     required only when admin bootstrap is enabled
#   XIAOWEI_MASTER_KEY          required (else gate 4 aborts — model-key encryption)
#   XIAOWEI_NEW_API_ADMIN_URL   required (New-API control plane, including /api)
#   XIAOWEI_MODEL_BASE_URL      required (OpenAI-compatible data plane, including /v1)
#   XIAOWEI_NEW_API_USERNAME    required (New-API administrator)
#   XIAOWEI_NEW_API_PASSWORD    required (New-API administrator)
#   XIAOWEI_MAX_USERS           default 100 (bootstrap and existing users count)
#   XIAOWEI_MAX_INVITATIONS_PER_USER default 3 (lifetime issues per account)
#   XIAOWEI_INVITATION_TTL_SECONDS default 604800 (7 days)
#   SKIP_TYPECHECK                default unset; set non-empty to skip the local gate

set -euo pipefail

DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

DEPLOY_SSH="${DEPLOY_SSH:-root@119.45.252.25}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/dsh-xiaowei}"
DSH_XIAOWEI_PORT="${DSH_XIAOWEI_PORT:-18000}"
DSH_XIAOWEI_PUBLIC_PORT="${DSH_XIAOWEI_PUBLIC_PORT:-18080}"
XIAOWEI_SEARXNG_PORT="${XIAOWEI_SEARXNG_PORT:-18081}"
DSH_HOME_DIR="${DSH_HOME_DIR:-/var/lib/dsh-xiaowei}"
SERVICE_NAME="dsh-xiaowei"
LEGACY_SERVICE_NAME="${LEGACY_SERVICE_NAME:-dsh-ops}"
NGINX_SNIPPET="/etc/nginx/conf.d/dsh-xiaowei.conf"
XIAOWEI_TRUSTED_HOSTS_EXTRA="${XIAOWEI_TRUSTED_HOSTS_EXTRA:-}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ ! "${XIAOWEI_SEARXNG_PORT}" =~ ^[0-9]+$ ]] || (( XIAOWEI_SEARXNG_PORT < 1 || XIAOWEI_SEARXNG_PORT > 65535 )); then
  printf '[deploy_xiaowei] FAIL: XIAOWEI_SEARXNG_PORT must be an integer from 1 to 65535\n' >&2
  exit 1
fi

log() { printf '[deploy_xiaowei] %s\n' "$*" >&2; }
fail() { log "FAIL: $*"; exit 1; }

# ─── gate 1: pre-flight ──────────────────────────────────────────────────────

if [[ "${SKIP_TYPECHECK:-}" == "" ]]; then
  log "gate 1: typecheck"
  if [[ "${DRY_RUN}" == "1" ]]; then
    log "  (dry-run) skip pnpm run typecheck"
  else
    (cd "${REPO_ROOT}" && pnpm run typecheck > /tmp/dsh-xiaowei-deploy-typecheck.log 2>&1) \
      || fail "pnpm run typecheck failed; see /tmp/dsh-xiaowei-deploy-typecheck.log"
  fi
else
  log "gate 1: typecheck skipped (SKIP_TYPECHECK set)"
fi

# The source-plane typecheck does not necessarily emit every Xiaowei public
# subpath. Build the bundle artifact plane before rsync because loader entries
# resolve package exports under lib/ on the production profile.
log "gate 1: build Xiaowei runtime bundle"
if [[ "${DRY_RUN}" == "1" ]]; then
  log "  (dry-run) tsc -b packages/bundle/xiaowei/tsconfig.json && tsdown --config packages/bundle/xiaowei/tsdown.config.ts"
else
  (cd "${REPO_ROOT}" \
    && pnpm exec tsc -b packages/bundle/xiaowei/tsconfig.json \
    && pnpm exec tsdown --config packages/bundle/xiaowei/tsdown.config.ts \
  ) > /tmp/dsh-xiaowei-deploy-bundle-build.log 2>&1 \
    || fail "Xiaowei runtime bundle build failed; see /tmp/dsh-xiaowei-deploy-bundle-build.log"
fi

log "gate 1: git clean check"
if [[ "${DRY_RUN}" == "0" ]]; then
  if ! (cd "${REPO_ROOT}" && git diff --quiet HEAD -- . ':!docs'); then
    log "  WARNING: working tree has uncommitted changes; the deploy will include them"
  fi
fi

log "gate 1: SSH probe ${DEPLOY_SSH}"
if [[ "${DRY_RUN}" == "0" ]]; then
  ssh -o BatchMode=yes -o ConnectTimeout=5 "${DEPLOY_SSH}" true \
    || fail "SSH ${DEPLOY_SSH} is not passwordless; the deploy script never asks for a password"
fi

# Required env for production runs. An already provisioned remote server.env
# is authoritative, so operators do not need to export its secrets locally.
REMOTE_ENV_PATH="/etc/dsh-xiaowei/server.env"
REMOTE_SECRETS_READY=0
if [[ "${DRY_RUN}" == "0" ]]; then
  if ssh -o BatchMode=yes "${DEPLOY_SSH}" "set -eu; test -r ${REMOTE_ENV_PATH}; for key in XIAOWEI_MASTER_KEY XIAOWEI_NEW_API_ADMIN_URL XIAOWEI_MODEL_BASE_URL XIAOWEI_NEW_API_USERNAME XIAOWEI_NEW_API_PASSWORD; do grep -Eq \"^\${key}=[^[:space:]]\" ${REMOTE_ENV_PATH}; done" >/dev/null 2>&1; then
    REMOTE_SECRETS_READY=1
    log "gate 1: required secrets found in remote ${REMOTE_ENV_PATH}"
  fi
fi

if [[ "${DRY_RUN}" == "0" && "${REMOTE_SECRETS_READY}" == "0" ]]; then
  log "gate 1: remote required secrets are incomplete; checking local exports"
  if [[ -n "${XIAOWEI_ADMIN_EMAIL:-}" && -z "${XIAOWEI_ADMIN_PASSWORD:-}" ]]; then
    fail "XIAOWEI_ADMIN_PASSWORD is required when XIAOWEI_ADMIN_EMAIL enables bootstrap"
  fi
  if [[ -z "${XIAOWEI_MASTER_KEY:-}" ]]; then
    fail "XIAOWEI_MASTER_KEY is required for production deploy (AES-256-GCM key encryption)"
  fi
  if [[ -z "${XIAOWEI_NEW_API_ADMIN_URL:-}" ]]; then
    fail "XIAOWEI_NEW_API_ADMIN_URL is required for production deploy (New-API control plane)"
  fi
  if [[ -z "${XIAOWEI_MODEL_BASE_URL:-}" ]]; then
    fail "XIAOWEI_MODEL_BASE_URL is required for production deploy (model data plane)"
  fi
  if [[ -z "${XIAOWEI_NEW_API_USERNAME:-}" ]]; then
    fail "XIAOWEI_NEW_API_USERNAME is required for production deploy (New-API administrator)"
  fi
  if [[ -z "${XIAOWEI_NEW_API_PASSWORD:-}" ]]; then
    fail "XIAOWEI_NEW_API_PASSWORD is required for production deploy (New-API administrator)"
  fi
fi

# ─── gate 2: remote backup ───────────────────────────────────────────────────

REMOTE_BACKUP_TAG="$(date -u +%Y%m%dT%H%M%SZ)"
REMOTE_BACKUP_DIR="${DEPLOY_DIR}.bak-${REMOTE_BACKUP_TAG}"

run_remote() {
  if [[ "${DRY_RUN}" == "1" ]]; then
    log "  (dry-run) ssh ${DEPLOY_SSH} $*"
  else
    ssh -o BatchMode=yes "${DEPLOY_SSH}" "$@"
  fi
}

log "gate 2: remote backup → ${REMOTE_BACKUP_DIR}"
if [[ "${DRY_RUN}" == "0" ]]; then
  run_remote "set -e; if [[ -d ${DEPLOY_DIR} ]]; then cp -a ${DEPLOY_DIR} ${REMOTE_BACKUP_DIR}; else mkdir -p ${DEPLOY_DIR}; fi" \
    || fail "remote backup failed"
fi

# ─── gate 3: code sync ───────────────────────────────────────────────────────

REMOTE_ARTIFACTS=(
  "packages"
  "vendor"
  "apps"
  "scripts"
  "patches"
  "native"
  "tsconfig.json"
  "tsconfig.base.json"
  "tsconfig.base.client.json"
  "tsconfig.client.json"
  "tsconfig.host.json"
  "pnpm-workspace.yaml"
  "package.json"
  "pnpm-lock.yaml"
)

# Built web SPA dist (vite output). Lives under apps/web/dist and is what
# frontend-static serves in the xiaowei profile. Built locally; not in source.
WEB_DIST_SRC="${REPO_ROOT}/apps/web/dist"
WEB_DIST_PATH="apps/web/dist"

EXCLUDES=(
  --exclude=node_modules
  --exclude=.git
  --exclude=.env
  --exclude=__pycache__
  --exclude=.cache
  --exclude='*.bak-*'
  --exclude='.venv'
  # The desktop client is published separately. Neither its sources nor its
  # multi-gigabyte installers serve the Xiaowei backend or Web SPA.
  --exclude=desktop
)

log "gate 3: rsync to ${DEPLOY_SSH}:${DEPLOY_DIR}"
for path in "${REMOTE_ARTIFACTS[@]}"; do
  if [[ "${DRY_RUN}" == "1" ]]; then
    log "  (dry-run) rsync ${EXCLUDES[*]} ${REPO_ROOT}/${path} ${DEPLOY_SSH}:${DEPLOY_DIR}/"
  else
    rsync -a --delete "${EXCLUDES[@]}" "${REPO_ROOT}/${path}" "${DEPLOY_SSH}:${DEPLOY_DIR}/" \
      || fail "rsync of ${path} failed"
  fi
done

log "gate 3: rsync built SPA dist ${WEB_DIST_PATH}/"
if [[ -d "${WEB_DIST_SRC}" ]]; then
  if [[ "${DRY_RUN}" == "1" ]]; then
    log "  (dry-run) rsync -a ${WEB_DIST_SRC}/ ${DEPLOY_SSH}:${DEPLOY_DIR}/${WEB_DIST_PATH}/"
  else
    rsync -a "${WEB_DIST_SRC}/" "${DEPLOY_SSH}:${DEPLOY_DIR}/${WEB_DIST_PATH}/" \
      || fail "rsync of ${WEB_DIST_PATH} failed"
  fi
else
  log "  WARNING: ${WEB_DIST_SRC} not built locally; frontend-static will 404 until next build"
fi

# ─── gate 3.5: systemd unit + nginx snippet + server.env ─────────────────────

DEPLOY_UNIT="[Unit]
Description=dsh xiaowei profile (long-running multi-user agent harness)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=${DEPLOY_DIR}
Environment=DSH_HOME=${DSH_HOME_DIR}
Environment=XIAOWEI_PORT=${DSH_XIAOWEI_PORT}
Environment=XIAOWEI_HOST=127.0.0.1
EnvironmentFile=-/etc/dsh-xiaowei/server.env
ExecStart=/usr/bin/env bash -lc 'cd ${DEPLOY_DIR} && pnpm dsh --profile xiaowei'
Restart=on-failure
RestartSec=5s
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target"

if [[ "${DRY_RUN}" == "1" ]]; then
  log "  (dry-run) cat /etc/systemd/system/${SERVICE_NAME}.service <<EOF"
  printf '%s\n' "${DEPLOY_UNIT}" >&2
  log "EOF"
else
  printf '%s\n' "${DEPLOY_UNIT}" | ssh "${DEPLOY_SSH}" "cat > /etc/systemd/system/${SERVICE_NAME}.service"
fi

# Public authority the fence will trust. The xiaowei cordis.patch.yml builds
# `trustedHosts` from `XIAOWEI_TRUSTED_HOSTS` (comma-separated). We always
# include loopback + the resolved public IP + the resolved public hostname;
# operators append more (e.g. internal LAN IPs) via XIAOWEI_TRUSTED_HOSTS_EXTRA.
PUBLIC_HOST_IP="$(printf '%s' "${DEPLOY_SSH}" | sed -E 's|^[^@]+@||')"
if [[ -z "${PUBLIC_HOST_IP}" ]]; then
  PUBLIC_HOST_IP="${DEPLOY_SSH}"
fi
TRUSTED_HOSTS="127.0.0.1,localhost,${PUBLIC_HOST_IP}"
if [[ -n "${XIAOWEI_TRUSTED_HOSTS_EXTRA}" ]]; then
  TRUSTED_HOSTS="${TRUSTED_HOSTS},${XIAOWEI_TRUSTED_HOSTS_EXTRA}"
fi

NGINX_SNIPPET_CONTENT="# Managed by scripts/deploy_xiaowei.sh. Do not edit by hand;
# re-run the deploy script to regenerate.
#
# Reverse-proxy public :${DSH_XIAOWEI_PUBLIC_PORT} → loopback :${DSH_XIAOWEI_PORT}.
# Xiaowei's trustedHosts fence is wired to accept requests whose Host header
# matches one of:
#   - 127.0.0.1 / localhost (direct loopback)
#   - ${PUBLIC_HOST_IP}        (direct public — desktop clients hitting :${DSH_XIAOWEI_PUBLIC_PORT} directly)
# All other Host headers fall outside the fence and the api-proxy returns 403.

map \$http_upgrade \$connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    # The legacy Workbench config remains the default server for the hostname
    # route. This server owns only the bare-IP client authority baked into the
    # desktop release, so nginx can select it without a duplicate default.
    listen ${DSH_XIAOWEI_PUBLIC_PORT};
    listen [::]:${DSH_XIAOWEI_PUBLIC_PORT};
    server_name ${PUBLIC_HOST_IP};

    # 300 MB matches cordis.patch.yml's maxRequestBodyBytes (314572800).
    client_max_body_size 300m;
    proxy_read_timeout   600s;
    proxy_send_timeout   600s;

    location /releases/ {
        alias /var/lib/xiaowei-workbench/releases/;
        add_header Cache-Control "no-cache";
    }

    location / {
        proxy_pass         http://127.0.0.1:${DSH_XIAOWEI_PORT};
        proxy_http_version 1.1;
        proxy_set_header   Host              \$host;
        proxy_set_header   X-Real-IP         \$remote_addr;
        proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_set_header   Upgrade           \$http_upgrade;
        proxy_set_header   Connection        \$connection_upgrade;
    }
}
"

log "gate 3.5: install nginx snippet at ${NGINX_SNIPPET}"
if [[ "${DRY_RUN}" == "1" ]]; then
  log "  (dry-run) cat ${NGINX_SNIPPET} <<EOF"
  printf '%s\n' "${NGINX_SNIPPET_CONTENT}" >&2
  log "EOF"
  log "  (dry-run) XIAOWEI_TRUSTED_HOSTS=${TRUSTED_HOSTS}"
else
  printf '%s\n' "${NGINX_SNIPPET_CONTENT}" | ssh "${DEPLOY_SSH}" "cat > ${NGINX_SNIPPET}" \
    || fail "nginx snippet write failed"
fi

# server.env — credentials the deploy expects on disk. The deploy script
# writes them only when they are not already present (idempotent), so a
# secret rotation that happens through a separate admin path is preserved.
log "gate 3.5: write /etc/dsh-xiaowei/server.env (idempotent — only sets missing keys)"
if [[ "${DRY_RUN}" == "0" ]]; then
  run_remote "set -e; mkdir -p /etc/dsh-xiaowei; touch /etc/dsh-xiaowei/server.env; chmod 600 /etc/dsh-xiaowei/server.env" \
    || fail "server.env dir init failed"
  # Idempotent upsert: only write a key if it isn't already present.
  for kv in \
    "XIAOWEI_TRUSTED_HOSTS=${TRUSTED_HOSTS}" \
    "XIAOWEI_ADMIN_EMAIL=${XIAOWEI_ADMIN_EMAIL:-}" \
    "XIAOWEI_ADMIN_PASSWORD=${XIAOWEI_ADMIN_PASSWORD:-}" \
    "XIAOWEI_ADMIN_DISPLAY_NAME=${XIAOWEI_ADMIN_DISPLAY_NAME:-admin}" \
    "XIAOWEI_MASTER_KEY=${XIAOWEI_MASTER_KEY:-}" \
    "XIAOWEI_NEW_API_ADMIN_URL=${XIAOWEI_NEW_API_ADMIN_URL:-}" \
    "XIAOWEI_MODEL_BASE_URL=${XIAOWEI_MODEL_BASE_URL:-}" \
    "XIAOWEI_NEW_API_USERNAME=${XIAOWEI_NEW_API_USERNAME:-}" \
    "XIAOWEI_NEW_API_PASSWORD=${XIAOWEI_NEW_API_PASSWORD:-}" \
    "XIAOWEI_NEW_API_GROUP=${XIAOWEI_NEW_API_GROUP:-default}" \
    "XIAOWEI_NEW_API_TOKEN_QUOTA=${XIAOWEI_NEW_API_TOKEN_QUOTA:-0}" \
    "XIAOWEI_NEW_API_TOKEN_UNLIMITED=${XIAOWEI_NEW_API_TOKEN_UNLIMITED:-true}" \
    "XIAOWEI_NEW_API_TOKEN_EXPIRES_DAYS=${XIAOWEI_NEW_API_TOKEN_EXPIRES_DAYS:-0}" \
    "XIAOWEI_MODEL_CONTEXT_WINDOW=${XIAOWEI_MODEL_CONTEXT_WINDOW:-131072}" \
    "XIAOWEI_MODEL_MAX_OUTPUT_TOKENS=${XIAOWEI_MODEL_MAX_OUTPUT_TOKENS:-32768}" \
    "XIAOWEI_INPUT_PRICE_MICROS_PER_TOKEN=${XIAOWEI_INPUT_PRICE_MICROS_PER_TOKEN:-1}" \
    "XIAOWEI_OUTPUT_PRICE_MICROS_PER_TOKEN=${XIAOWEI_OUTPUT_PRICE_MICROS_PER_TOKEN:-8}" \
    "XIAOWEI_MISSING_USAGE_POLICY=${XIAOWEI_MISSING_USAGE_POLICY:-reserve}" \
    "XIAOWEI_NEW_API_TIMEOUT_MS=${XIAOWEI_NEW_API_TIMEOUT_MS:-10000}" \
    "XIAOWEI_NEW_API_RETRIES=${XIAOWEI_NEW_API_RETRIES:-2}" \
    "XIAOWEI_RESERVATION_TTL_SECONDS=${XIAOWEI_RESERVATION_TTL_SECONDS:-3600}" \
    "XIAOWEI_EMAIL_VERIFICATION=${XIAOWEI_EMAIL_VERIFICATION:-false}" \
    "XIAOWEI_MAX_USERS=${XIAOWEI_MAX_USERS:-100}" \
    "XIAOWEI_MAX_INVITATIONS_PER_USER=${XIAOWEI_MAX_INVITATIONS_PER_USER:-3}" \
    "XIAOWEI_INVITATION_TTL_SECONDS=${XIAOWEI_INVITATION_TTL_SECONDS:-604800}" \
    "XIAOWEI_SESSION_TTL_SECONDS=${XIAOWEI_SESSION_TTL_SECONDS:-86400}" \
    "XIAOWEI_WELCOME_BONUS_MICROS=${XIAOWEI_WELCOME_BONUS_MICROS:-20000000}" \
    "XIAOWEI_DAILY_REFRESH_MICROS=${XIAOWEI_DAILY_REFRESH_MICROS:-0}" \
    "XIAOWEI_KEY_TTL_DAYS=${XIAOWEI_KEY_TTL_DAYS:-3650}" \
    "XIAOWEI_SERVE_FRONTEND=${XIAOWEI_SERVE_FRONTEND:-true}" \
    "SEARXNG_BASE_URL=${SEARXNG_BASE_URL:-http://127.0.0.1:${XIAOWEI_SEARXNG_PORT}}" \
  ; do
    key="${kv%%=*}"
    val="${kv#*=}"
    # Keys are generated identifiers, so anchoring the literal key prevents
    # duplicate assignments while values never participate in the match.
    run_remote "set -e; if ! grep -q '^${key}=' /etc/dsh-xiaowei/server.env; then printf '%s=%s\n' '${key}' '${val}' >> /etc/dsh-xiaowei/server.env; fi" \
      || fail "server.env upsert failed for ${key}"
  done
fi

# ─── gate 4: install ─────────────────────────────────────────────────────────

log "gate 4: pnpm install on remote"
if [[ "${DRY_RUN}" == "0" ]]; then
  # monorepo workspace: workspace:* links need the full dep set; --prod would
  # drop devDependencies and break the dsh CLI's tsx-based source launcher.
  # The repository lockfile supports desktop packaging on macOS, Linux, and
  # Windows. Production is Linux x64 only; constraining pnpm here prevents
  # optional Codex/Claude native packages for five foreign targets from
  # consuming server disk while preserving the Linux x64 runtime artifacts.
  run_remote "cd ${DEPLOY_DIR} && ELECTRON_SKIP_BINARY_DOWNLOAD=1 pnpm --config.supportedArchitectures='{"os":["linux"],"cpu":["x64"],"libc":["glibc"]}' install --frozen-lockfile --prefer-offline" \
    || fail "remote pnpm install failed"
fi

# ─── gate 4.2: loopback SearXNG ─────────────────────────────────────────────

log "gate 4.2: deploy loopback SearXNG on 127.0.0.1:${XIAOWEI_SEARXNG_PORT}"
if [[ "${DRY_RUN}" == "1" ]]; then
  log "  (dry-run) XIAOWEI_SEARXNG_PORT=${XIAOWEI_SEARXNG_PORT} bash ${DEPLOY_DIR}/scripts/xiaowei/searxng/deploy.sh"
else
  run_remote "XIAOWEI_SEARXNG_PORT=${XIAOWEI_SEARXNG_PORT} bash ${DEPLOY_DIR}/scripts/xiaowei/searxng/deploy.sh" \
    || fail "loopback SearXNG deploy or JSON search probe failed"
fi

# ─── gate 4.5: profile directory + bundle deps ──────────────────────────────

# Profiles live in $DSH_HOME/profiles/<name>/; the CLI resolves the bundle deps
# through that directory's own node_modules + the workspace-wide flat fallback.
PROFILE_DIR="${DSH_HOME_DIR}/profiles/xiaowei"
PROFILE_PKG='{
  "name": "dsh-profile-xiaowei",
  "private": true,
  "dependencies": {
    "@deepseek-ai/dsh-base": "workspace:^",
    "@deepseek-ai/dsh-xiaowei": "workspace:^"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-xiaowei"
      ]
    }
  }
}'
PROFILE_PATCH='[]
'

log "gate 4.5: init profile at ${PROFILE_DIR}"
# The dsh CLI heals $DSH_HOME/profiles/node_modules on launch by symlinking
# every package in the app's dependency closure, so the profile dir itself
# needs no pnpm install — only its manifest + an empty user patch layer.
if [[ "${DRY_RUN}" == "0" ]]; then
  run_remote "set -e; mkdir -p ${PROFILE_DIR}; printf '%s' '${PROFILE_PKG}' > ${PROFILE_DIR}/package.json; printf '%s' '${PROFILE_PATCH}' > ${PROFILE_DIR}/cordis.patch.yml" \
    || fail "profile init failed"
fi

# ─── gate 4.7: nginx config syntax check + reload ───────────────────────────

log "gate 4.7: nginx -t + reload"
if [[ "${DRY_RUN}" == "0" ]]; then
  run_remote "set -e; if command -v nginx >/dev/null 2>&1; then nginx -t && nginx -s reload; else echo 'nginx not installed on remote — skipping snippet activation (direct loopback still works)'; fi" \
    || fail "nginx -t / reload failed"
fi

# ─── gate 5: restart ─────────────────────────────────────────────────────────

log "gate 5: stop legacy ${LEGACY_SERVICE_NAME} and restart ${SERVICE_NAME}"
if [[ "${DRY_RUN}" == "0" ]]; then
  run_remote "systemctl daemon-reload && systemctl enable ${SERVICE_NAME} && (systemctl stop ${LEGACY_SERVICE_NAME} 2>/dev/null || true) && systemctl restart ${SERVICE_NAME}" \
    || fail "systemctl restart failed"
fi

# ─── gate 6: health check ────────────────────────────────────────────────────
# Two probes: (a) loopback /health, the direct api-proxy signal; (b) public
# :18080/health, the reverse-proxy end-to-end (covers nginx config + fence).

probe_health() {
  local label="$1" url="$2"
  local attempt
  for attempt in 1 2 3 4 5; do
    if [[ "${DRY_RUN}" == "1" ]]; then
      log "  (dry-run) ${label} attempt ${attempt}/5 curl --max-time 5 ${url}"
      return 0
    fi
    if ssh -o BatchMode=yes "${DEPLOY_SSH}" "curl --max-time 5 -fsS ${url} > /dev/null"; then
      log "  ${label} attempt ${attempt}/5 passed"
      return 0
    fi
    log "  ${label} attempt ${attempt}/5 failed; sleeping 2s"
    sleep 2
  done
  return 1
}

log "gate 6: health probe http://127.0.0.1:${DSH_XIAOWEI_PORT}/health (loopback)"
if ! probe_health "loopback" "http://127.0.0.1:${DSH_XIAOWEI_PORT}/health"; then
  log "FAIL: loopback health probe never returned 200"
  log "rollback command (run from your shell):"
  log "  ssh ${DEPLOY_SSH} 'systemctl stop ${SERVICE_NAME} && rm -rf ${DEPLOY_DIR} && mv ${REMOTE_BACKUP_DIR} ${DEPLOY_DIR} && systemctl start ${SERVICE_NAME}'"
  exit 1
fi

log "gate 6: health probe http://127.0.0.1:${DSH_XIAOWEI_PUBLIC_PORT}/health (through nginx)"
if ! probe_health "public" "http://127.0.0.1:${DSH_XIAOWEI_PUBLIC_PORT}/health"; then
  log "FAIL: public health probe (through nginx) never returned 200"
  log "  nginx is up but the api-proxy is unreachable from :${DSH_XIAOWEI_PUBLIC_PORT}."
  log "  Most likely: ${NGINX_SNIPPET} did not load or proxy_pass target is wrong."
  log "  Inspect remote nginx:    ssh ${DEPLOY_SSH} 'nginx -T | grep -A4 ${DSH_XIAOWEI_PUBLIC_PORT}'"
  log "  Inspect remote service:  ssh ${DEPLOY_SSH} 'systemctl status ${SERVICE_NAME} --no-pager'"
  log "  Inspect remote logs:     ssh ${DEPLOY_SSH} 'journalctl -u ${SERVICE_NAME} -n 200 --no-pager'"
  log "rollback command (run from your shell):"
  log "  ssh ${DEPLOY_SSH} 'systemctl stop ${SERVICE_NAME} && rm -rf ${DEPLOY_DIR} && mv ${REMOTE_BACKUP_DIR} ${DEPLOY_DIR} && systemctl start ${SERVICE_NAME}'"
  exit 1
fi

log "deploy complete"
log "remote backup at ${DEPLOY_SSH}:${REMOTE_BACKUP_DIR}"
log "service log:    ssh ${DEPLOY_SSH} journalctl -u ${SERVICE_NAME} -f"
log "trusted hosts:  ${TRUSTED_HOSTS}"
log "loopback URL:   http://127.0.0.1:${DSH_XIAOWEI_PORT}/api/<method>"
log "public URL:     http://${PUBLIC_HOST_IP}:${DSH_XIAOWEI_PUBLIC_PORT}/api/<method>"
