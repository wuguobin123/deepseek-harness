# Agent Note: xiaowei production deploy script

Status: implemented

English | [中文](2026-08-24-xiaowei-production-deploy-script.zh.md)

## Problem

`dsh-ops` ships with `scripts/deploy_dsh.sh` — a 6-gate deploy flow (preflight, backup, sync, install, restart, health) that wires the systemd unit, rsyncs the repo, and curls `/health`. The xiaowei bundle needs the same operational shape plus three xiaowei-specific extras:

- **Public entrypoint through nginx** — desktop clients connect to a public-facing port (`:18080`); the api-proxy binds loopback (`:18000`); nginx reverse-proxies between them. The deploy must write both halves of that wiring or the public clients get 502s.
- **`XIAOWEI_TRUSTED_HOSTS` derived from the deploy target** — the bundle's fence recognizes the public IP as a trusted host so desktop clients that hit `:18080` directly (not just through the in-process loopback) don't 403. The deploy script is the one place that knows the public IP.
- **Idempotent `server.env` write** — `XIAOWEI_ADMIN_EMAIL` / `XIAOWEI_ADMIN_PASSWORD` / `XIAOWEI_MASTER_KEY` exist in `/etc/dsh-xiaowei/server.env` and must survive a redeploy without being overwritten (a manual secret rotation that happens through a separate admin path must not be reset). The deploy script's previous-instance pattern (`-a /opt/dsh-ops /opt/dsh-ops.bak-…`) covers the code, but the env file is a separate concern.

Without these three pieces the bundle boots but the desktop client cannot reach it through the public port.

## Decision

`scripts/deploy_xiaowei.sh` is the canonical production entry point. It is a sibling to `scripts/deploy_dsh.sh` and follows the same 6-gate shape; the differences are concentrated in **gate 3.5** (nginx snippet + `server.env` upsert) and **gate 6** (two health probes — one loopback, one through nginx).

### Gate 3.5: nginx + server.env

The deploy script:

1. Derives `PUBLIC_HOST_IP` from `DEPLOY_SSH` (strips `user@`).
2. Builds `TRUSTED_HOSTS = "127.0.0.1,localhost,<PUBLIC_HOST_IP>"` plus operator-supplied `XIAOWEI_TRUSTED_HOSTS_EXTRA`.
3. Writes `/etc/nginx/conf.d/dsh-xiaowei.conf` with:
   - `listen 18080 default_server` (IPv4 + IPv6).
   - `proxy_pass http://127.0.0.1:18000`.
   - `client_max_body_size 300m` matching `cordis.patch.yml`'s `maxRequestBodyBytes: 314572800`.
   - `proxy_read_timeout 600s` / `proxy_send_timeout 600s` to keep long agent turns alive.
   - WebSocket upgrade headers (`Upgrade` / `Connection $connection_upgrade`) so the `events.mux` / `events.host` downlinks reach the api-proxy — without these, nginx returns `HTTP 426 Upgrade Required` and the desktop never sees the host frames. The `map $http_upgrade $connection_upgrade` block is required because nginx's default is to close on non-upgrade requests.
   - `proxy_set_header Host $host` so the fence sees the original authority (otherwise nginx sends `Host: 127.0.0.1:18000` and the trusted-host check fails when the public IP is not in `trustedHosts`).
4. Runs `nginx -t && nginx -s reload` (gate 4.7) — `set -e` aborts on a syntax error so the next gate's restart doesn't start a service behind a broken proxy.
5. Writes `/etc/dsh-xiaowei/server.env` (mode `0600`) **idempotently** — each key is upserted via `if ! grep -F -q '^KEY=' server.env; then printf 'KEY=%s\n' >> server.env; fi`. Missing keys are added; existing keys are preserved. `grep -F` (fixed string) avoids regex metacharacter pitfalls in the values.

### Required env on deploy (gate 1)

`XIAOWEI_ADMIN_EMAIL`, `XIAOWEI_ADMIN_PASSWORD`, and `XIAOWEI_MASTER_KEY` are required and the script `fail`s at gate 1 if any is missing. These are the bootstrap admin user and the AES-256-GCM master key — neither has a default, and the deploy must not run without them.

### Two health probes (gate 6)

- Loopback: `curl --max-time 5 -fsS http://127.0.0.1:18000/health` (5 attempts, 2s sleep).
- Public: `curl --max-time 5 -fsS http://127.0.0.1:18080/health` (5 attempts, 2s sleep).

Both must succeed. The loopback probe tests the api-proxy alone; the public probe tests `nginx → 18000`. A failure on either prints a specific rollback hint: loopback failure → restore the backup tree and restart; public failure → inspect the nginx snippet and the service's journalctl.

### Other environment overrides

- `DEPLOY_SSH` — default `root@119.45.252.25`.
- `DEPLOY_DIR` — default `/opt/dsh-xiaowei`.
- `DSH_XIAOWEI_PORT` — default `18000` (loopback bind).
- `DSH_XIAOWEI_PUBLIC_PORT` — default `18080` (nginx listen).
- `DSH_HOME_DIR` — default `/var/lib/dsh-xiaowei`.
- `XIAOWEI_TRUSTED_HOSTS_EXTRA` — comma-separated extras (LAN-side hostnames, internal proxies).
- `SKIP_TYPECHECK` — set non-empty to skip gate 1's `pnpm run typecheck`.

### systemd unit

Writes `/etc/systemd/system/dsh-xiaowei.service`:

- `Environment=DSH_HOME=/var/lib/dsh-xiaowei` (data root).
- `Environment=DSH_XIAOWEI_PORT=18000` (loopback bind).
- `Environment=XIAOWEI_HOST=127.0.0.1` (forces loopback bind even if `XIAOWEI_HOST` is exported in the operator's shell).
- `EnvironmentFile=-/etc/dsh-xiaowei/server.env` (the dash prefix tolerates a missing file — useful for first-time deploys before the env file exists).
- `ExecStart=/usr/bin/env bash -lc 'cd /opt/dsh-xiaowei && pnpm dsh --profile xiaowei'`.
- `Restart=on-failure`, `RestartSec=5s`, `WatchdogSec=30s` (the process does not call `sd_notify`, so the watchdog does not fire).
- `StandardOutput=journal` / `StandardError=journal`.

### Profile init

The script writes `/var/lib/dsh-xiaowei/profiles/xiaowei/package.json` + an empty `cordis.patch.yml` so the dsh CLI's profile resolver finds the bundle deps. The CLI heals `profiles/node_modules` on launch by symlinking every workspace dep; no `pnpm install` runs in the profile directory.

### Dry-run

`--dry-run` prints every rsync target, every remote command, the systemd unit body, the nginx snippet body, and the `XIAOWEI_TRUSTED_HOSTS` value. It does **not** check the required env (gate 1's email/password/master-key check is skipped), so a dry-run works without real secrets.

## Alternatives considered

- **One script that deploys both `dsh-ops` and `dsh-xiaowei`** — rejected. The two profiles are operationally distinct: different systemd units, different `DSH_HOME` roots, different `trustedHosts` policies, different public-nginx frontends. A unified script would either grow conditionals or two parallel branches that diverge every quarter. Two scripts with shared shape is easier to audit.
- **Write `server.env` only once and overwrite on every deploy** — rejected. A manual secret rotation through the operator's own admin path (e.g. `dsh-ops admin wallet.setQuota` rotation) writes to `server.env` and must survive a code redeploy. The idempotent upsert preserves operator-set values.
- **Put nginx config inline in the systemd unit** — rejected. systemd does not configure nginx; the nginx snippet must be at the canonical include path. The deploy script writes both halves and reloads nginx once.
- **Curl `https://...` (real HTTPS with Let's Encrypt)** — out of scope. The current production is plain HTTP at `:18080`; TLS termination belongs to a CDN or fronting LB, not the dsh host. Future PR adds the cert path.
- **Use `systemd` socket activation instead of nginx** — rejected. nginx is already on the box (used by `xiaowei-workbench.conf` for `/releases/`); adding a socket unit would duplicate the listen. nginx is the canonical place for the public port.
- **Always overwrite `XIAOWEI_TRUSTED_HOSTS` from the deploy target** — rejected. Operators may add extra trusted hosts (`XIAOWEI_TRUSTED_HOSTS_EXTRA`) that are not derivable from `DEPLOY_SSH`. The script only sets the value if it is absent; a redeploy without the env var keeps the operator's value.
- **Bake nginx into the systemd unit's `ExecStartPre`** — rejected. nginx runs as root and systemd's `ExecStartPre` runs in the service's cgroup; a config error in nginx would silently kill the deploy. The standalone `nginx -t` + `nginx -s reload` gate 4.7 catches it visibly.
- **Probe only the loopback `/health`** — rejected. A misconfigured nginx snippet that 502s every public request would pass the loopback probe and the production outage would surface at first desktop login. The double probe makes the deploy fail before any user is affected.

## Consequences

### What this bought

- **One-shot production deploy** — `scripts/deploy_xiaowei.sh` (no flags) is the operator-facing entry. The script handles backup, rsync, systemd, nginx, env-file, restart, and two-tier health.
- **Idempotent env-file** — manual secret rotations survive a redeploy.
- **Visible failure modes** — both nginx syntax errors and api-proxy boot failures abort the deploy with specific hints before the systemd unit is restarted.
- **Mirrors `dsh-ops`** — operators who already run `scripts/deploy_dsh.sh` learn the new script in five minutes.

### What this cost

- **Two files to maintain** — `deploy_dsh.sh` and `deploy_xiaowei.sh`. Shared shape, diverging details. The two scripts diverge on systemd unit names, env-file paths, public-port wiring, and health-probe targets.
- **nginx is required on the box** — gate 4.7 no-ops if nginx is not installed, but that means the public port is not served. The deploy script logs the warning; it does not fail. A box without nginx needs the operator to manually configure the public port.
- **Required env on deploy** — `XIAOWEI_ADMIN_EMAIL` / `XIAOWEI_ADMIN_PASSWORD` / `XIAOWEI_MASTER_KEY` are mandatory. A test deploy without real values fails at gate 1. The script intentionally does not auto-generate a master key — the rotation story depends on the operator generating it externally and committing to its lifecycle.
- **Plain HTTP** — no TLS at the dsh host. The public port terminates plain HTTP; production-grade TLS lives at a fronting LB or CDN. Future PR.
- **No staging-vs-production knob** — the script always deploys to `DEPLOY_SSH` (default production). Operators who want a staging deploy override `DEPLOY_SSH` to the staging host and the script treats it identically; there is no `--environment` flag. Two scripts and two SSH targets is the current shape; a `dsh-deploy-multi` script is a future PR.
