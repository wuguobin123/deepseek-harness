#!/usr/bin/env bash
# scripts/deploy_dsh.sh — deploy the dsh harness (ops profile) to production.
#
# Mirrors the 6-gate flow of /Users/wuguobin/Documents/my-agents/.agents/skills/deploy-production/SKILL.md
# but for the dsh runtime. Six gates; any failure aborts:
#   1. Pre-flight: git clean + SSH + local typecheck.
#   2. Remote backup: snapshot the live /opt/dsh-ops tree.
#   3. Code sync: rsync the built artifacts + cordis.patches + scripts.
#   4. Install: pnpm install --prod on remote (or skip if vendor prebuilt).
#   5. Restart: systemctl restart dsh-ops.
#   6. Health: curl http://127.0.0.1:18000/health, 5 retries.
#
# Usage:
#   scripts/deploy_dsh.sh                # deploy
#   scripts/deploy_dsh.sh --dry-run      # preview the sync + remote commands
#
# Environment overrides:
#   DEPLOY_SSH         default root@119.45.252.25
#   DEPLOY_DIR         default /opt/dsh-ops
#   DSH_OPS_PORT       default 18000
#   SKIP_TYPECHECK     default unset; set non-empty to skip the local gate

set -euo pipefail

DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

DEPLOY_SSH="${DEPLOY_SSH:-root@119.45.252.25}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/dsh-ops}"
DSH_OPS_PORT="${DSH_OPS_PORT:-18000}"
DSH_HOME_DIR="${DSH_HOME_DIR:-/var/lib/dsh-ops}"
SERVICE_NAME="dsh-ops"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log() { printf '[deploy_dsh] %s\n' "$*" >&2; }
fail() { log "FAIL: $*"; exit 1; }

# ─── gate 1: pre-flight ──────────────────────────────────────────────────────

if [[ "${SKIP_TYPECHECK:-}" == "" ]]; then
  log "gate 1: typecheck"
  if [[ "${DRY_RUN}" == "1" ]]; then
    log "  (dry-run) skip pnpm run typecheck"
  else
    (cd "${REPO_ROOT}" && pnpm run typecheck > /tmp/dsh-deploy-typecheck.log 2>&1) \
      || fail "pnpm run typecheck failed; see /tmp/dsh-deploy-typecheck.log"
  fi
else
  log "gate 1: typecheck skipped (SKIP_TYPECHECK set)"
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
# frontend-static serves in the ops profile. Built locally; not in source.
WEB_DIST_SRC="${REPO_ROOT}/apps/web/dist"
WEB_DIST_PATH="apps/web/dist"

EXCLUDES=(
  --exclude=node_modules
  --exclude=.git
  --exclude=__pycache__
  --exclude=.cache
  --exclude='*.bak-*'
  --exclude='.venv'
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

log "gate 3: install systemd unit + deploy scripts"
DEPLOY_UNIT="[Unit]
Description=dsh ops profile (long-running agent harness)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=${DEPLOY_DIR}
Environment=DSH_HOME=${DSH_HOME_DIR}
Environment=DSH_OPS_PORT=${DSH_OPS_PORT}
EnvironmentFile=-/etc/dsh-ops/server.env
ExecStart=/usr/bin/env bash -lc 'cd ${DEPLOY_DIR} && pnpm dsh --profile ops'
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

# ─── gate 4: install ─────────────────────────────────────────────────────────

log "gate 4: pnpm install on remote"
if [[ "${DRY_RUN}" == "0" ]]; then
  # monorepo workspace: workspace:* links need the full dep set; --prod would
  # drop devDependencies and break the dsh CLI's tsx-based source launcher.
  run_remote "cd ${DEPLOY_DIR} && pnpm install --frozen-lockfile --prefer-offline" \
    || fail "remote pnpm install failed"
fi

# ─── gate 4.5: profile directory + bundle deps ──────────────────────────────

# Profiles live in $DSH_HOME/profiles/<name>/; the CLI resolves the bundle deps
# through that directory's own node_modules + the workspace-wide flat fallback.
PROFILE_DIR="${DSH_HOME_DIR}/profiles/ops"
PROFILE_PKG='{
  "name": "dsh-profile-ops",
  "private": true,
  "dependencies": {
    "@deepseek-ai/dsh-base": "workspace:^",
    "@deepseek-ai/dsh-ops": "workspace:^"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-ops"
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

# ─── gate 5: restart ─────────────────────────────────────────────────────────

log "gate 5: systemctl restart ${SERVICE_NAME}"
if [[ "${DRY_RUN}" == "0" ]]; then
  run_remote "systemctl daemon-reload && systemctl enable ${SERVICE_NAME} && systemctl restart ${SERVICE_NAME}" \
    || fail "systemctl restart failed"
fi

# ─── gate 6: health check ────────────────────────────────────────────────────

log "gate 6: health probe http://127.0.0.1:${DSH_OPS_PORT}/health"
HEALTH_OK=0
for attempt in 1 2 3 4 5; do
  if [[ "${DRY_RUN}" == "1" ]]; then
    log "  (dry-run) attempt ${attempt}/5 curl --max-time 5 http://127.0.0.1:${DSH_OPS_PORT}/health"
    HEALTH_OK=1
    break
  fi
  if ssh -o BatchMode=yes "${DEPLOY_SSH}" "curl --max-time 5 -fsS http://127.0.0.1:${DSH_OPS_PORT}/health > /dev/null"; then
    HEALTH_OK=1
    log "  attempt ${attempt}/5 passed"
    break
  fi
  log "  attempt ${attempt}/5 failed; sleeping 2s"
  sleep 2
done

if [[ "${HEALTH_OK}" != "1" ]]; then
  log "FAIL: health probe never returned 200"
  log "rollback command (run from your shell):"
  log "  ssh ${DEPLOY_SSH} 'systemctl stop ${SERVICE_NAME} && rm -rf ${DEPLOY_DIR} && mv ${REMOTE_BACKUP_DIR} ${DEPLOY_DIR} && systemctl start ${SERVICE_NAME}'"
  exit 1
fi

log "deploy complete"
log "remote backup at ${DEPLOY_SSH}:${REMOTE_BACKUP_DIR}"
log "service log:    ssh ${DEPLOY_SSH} journalctl -u ${SERVICE_NAME} -f"