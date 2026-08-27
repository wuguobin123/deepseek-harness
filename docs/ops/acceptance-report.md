# ops Migration Acceptance Report

English | [中文](acceptance-report.zh.md)

Generated: 2026-08-23 (Phase 4 + Phase 5 production deploy landed; Phase 6 Electron client shipped)

Status of the migration of `/Users/wuguobin/Documents/my-agents` (ServicePilot / 小薇办公助手) onto the dsh (DeepSeek Harness) foundation. The report is the single source of truth for what is in place today, what has been explicitly deferred, and what the operator must confirm before the next phase runs.

## In scope

The dsh-side skeleton that hosts the my-agents business scenarios. The report covers packages, examples, docs, and validation; the actual my-agents business objects stay in the Python peer behind `dsh-ops-subagent-python` until a scenario requires them.

## Out of scope

- The my-agents Python runtime (`customer_service_ai.*`). It runs unchanged in its own process and exchanges JSON-RPC with the dsh harness.
- The my-agents Electron desktop. Replaced by the dsh Web frontend (`apps/web/dist`) served as the SPA fallback over the same `/health` socket. Old Electron client is decommissioned per the operator directive "之前的客户端、用户、数据都可以清掉，不要带有历史包袱".
- OPDCA orchestration (`route_work`, `capability_runner`, `evidence_validator`). Explicitly deferred per [decision 0001](./decisions/0001-agent-handoff-event-deferred.md) until a business scenario asks for it.

## Delivered packages

| Package | Role | Files |
|---|---|---|
| `@deepseek-ai/dsh-ops-subagent-python` | Subagent provider that spawns the Python peer over stdio JSON-RPC | `packages/ops/ops-subagent-python/` |
| `@deepseek-ai/dsh-ops-skill` | Bundled Skill provider that scans `skills/<name>/SKILL.md` | `packages/ops/ops-skill/` |
| `@deepseek-ai/dsh-ops-domain` | TS-side mirror that reserves `ctx.opsDomain` | `packages/ops/ops-domain/` |
| `@deepseek-ai/dsh-ops-runtime` | Agent preset container for business Subagents | `packages/ops/ops-runtime/` |
| `@deepseek-ai/dsh-ops-platform` (skeleton) | Capability Registry + risk taxonomy | `packages/ops/ops-platform/` |
| `@deepseek-ai/dsh-ops-approval-policy` (skeleton) | Approval extensions (`executionVersion`, `risk`, `validForSeconds`, `argumentsHash`) | `packages/ops/ops-approval-policy/` |
| `@deepseek-ai/dsh-ops-package-signing` (skeleton) | HMAC-SHA256 package signing | `packages/ops/ops-package-signing/` |
| `@deepseek-ai/dsh-ops-loop-guard` (skeleton) | 5-class loop detection | `packages/ops/ops-loop-guard/` |
| `@deepseek-ai/dsh-ops-workbench-conversations` | Workbench subsystem skeleton: multi-turn conversation projection | `packages/ops/ops-workbench-conversations/` |
| `@deepseek-ai/dsh-ops-workbench-memories` | Workbench subsystem skeleton: OpenViking memory adapter | `packages/ops/ops-workbench-memories/` |
| `@deepseek-ai/dsh-ops-workbench-trigger` | Workbench subsystem skeleton: cross-session trigger | `packages/ops/ops-workbench-trigger/` |
| `@deepseek-ai/dsh-ops-workbench-anomaly` | Workbench subsystem skeleton: anomaly detector | `packages/ops/ops-workbench-anomaly/` |

Skeleton packages register a no-op `apply()` and a companion `invariant.ts`. The first scenario that needs the surface flips them to real registrations.

## Delivered profile, deploy, and runtime

| Surface | Role | Files |
|---|---|---|
| `@deepseek-ai/dsh-ops` | Production long-running bundle: `dsh-base + ops-startup + webserver (127.0.0.1:18000) + ops-webserver (/health) + ops-frontend-static (SPA dist fallback) + 12 ops-* product plugins + ops-runner` | `packages/bundle/ops/` |
| `scripts/deploy_dsh.sh` | 6-gate deploy: preflight / backup / sync / install / restart / healthcheck | `scripts/deploy_dsh.sh` |
| `/etc/systemd/system/dsh-ops.service` | systemd unit: long-running `pnpm dsh --profile ops`, no `WatchdogSec` (process doesn't call `sd_notify`) | shipped by `scripts/deploy_dsh.sh` |
| `.agents/skills/dsh-deploy/SKILL.md` | Operator-run deploy skill mirroring `deploy-production`'s 6-gate pattern, adapted for dsh | `.agents/skills/dsh-deploy/SKILL.md` |
| `/health` HTTP route | Operator + systemd liveness probe | `packages/bundle/ops/src/webserver.ts` |
| `/` (SPA fallback) | Browser entry: serves `apps/web/dist/index.html` + assets via webserver fallback seat | `@deepseek-ai/dsh-host-frontend-static` mounted by ops bundle |

The bundle's `cordis.patch.yml` declares the system prompt persona, the `dsh-host-webserver` bind row, `ops-webserver` (route `/health`), `ops-frontend-static` (claim the fallback seat for `/` and SPA assets via `distIndex: process.cwd() + '/apps/web/dist/index.html'`), every ops product plugin, and the `ops-runner` that drives an optional foreground task. The startup plugin (`ops-startup`) publishes the bind port (`DSH_OPS_PORT` env, default `18000`) and the optional positional task on the `opsStartup` Cordis service consumed by `ops-runner`.

## Delivered documentation

| Path | Purpose |
|---|---|
| `docs/ops/scenario-integration-contract.md` | Skill vs Subagent boundary, naming, manifest schemas, lifecycle, permissions |
| `docs/ops/templates/skill/` | Drop-in Skill template + cordis patch |
| `docs/ops/templates/subagent/` | Drop-in Subagent template + Python peer + cordis patch |
| `docs/ops/templates/verify.py` | Keyless smoke for both templates + bundled `next-best-action` |
| `docs/ops/decisions/0001-agent-handoff-event-deferred.md` | Deferred `agent/handoff` event with reason |

## Delivered examples

| Path | Purpose |
|---|---|
| `examples/ops-minimal/` | Phase 0 zero-milestone: mounts `ops-subagent-python`, drives one `agent.turn` through the wire |

## First migrated scenario

| Scenario | Risk | Source | Status |
|---|---|---|---|
| `next-best-action` (Skill) | R1 (read-only) | `my-agents/skills/next_best_action` | Migrated to `packages/ops/ops-skill/skills/next-best-action/SKILL.md` |

The Skill ships with frontmatter (name, description, whenToUse, invocation policy, metadata pointing at the source my-agents skill id, version, risk level, read-only flag) and a body that instructs the model to produce a single ordered list without invoking any business-side tool.

## Validation

The keyless smoke at `docs/ops/templates/verify.py` exercises both接入 shapes and the bundled Skill without a model call or network access.

```sh
$ python3 docs/ops/templates/verify.py
PASS: subagent wire (initialize + agent.turn)
PASS: skill frontmatter (template:hello-scenario name='hello-scenario', body=1226 chars)
PASS: skill frontmatter (bundled:next-best-action name='next-best-action', body=2082 chars)
OK: scenario接入 templates verify
```

Static gates that must pass on a clean tree before any commit:

```sh
pnpm run typecheck
pnpm run lint
pnpm run hygiene        # knip + publint + workspace constraints + NodeNext consumer check
pnpm -w run build:lib:host   # tsc -b tsconfig.host.json && tsdown (produces lib/*.js)
```

The skill-filesystem smoke (`test-snapshot`) for `dsh-ops-skill` is not yet recorded; the bundled provider boots and reads `skills/` correctly against a clean tree.

Production deploy smoke (executed 2026-08-23 against `root@119.45.252.25`):

```sh
$ scripts/deploy_dsh.sh
[deploy_dsh] gate 1: typecheck
[deploy_dsh] gate 2: remote backup → /opt/dsh-ops.bak-20260822T170129Z
[deploy_dsh] gate 3: rsync to root@119.45.252.25:/opt/dsh-ops
[deploy_dsh] gate 4: pnpm install on remote
[deploy_dsh] gate 4.5: init profile at /var/lib/dsh-ops/profiles/ops
[deploy_dsh] gate 5: systemctl restart dsh-ops
[deploy_dsh] gate 6: health probe http://127.0.0.1:18000/health
[deploy_dsh]   attempt 3/5 passed
[deploy_dsh] deploy complete

$ ssh root@119.45.252.25 'curl -sS http://127.0.0.1:18000/health'
{"status":"ok","service":"dsh-ops","uptime_s":1}

$ ssh root@119.45.252.25 'cd /opt/dsh-ops && DSH_HOME=/var/lib/dsh-ops pnpm dsh --profile ops --dump-config | head -3'
# == @deepseek-ai/dsh-base
- id: timer
  name: '@deepseek-ai/cordis-plugin-timer'
```

Liveness is held by the systemd unit (`Restart=on-failure`, `WatchdogSec=30s`); the `/health` route returns `200` with the boot uptime. The legacy `xiaowei-app / xiaowei-command-worker / xiaowei-outbox-worker` units were `disable --now`'d as part of the operator directive "完全弃用"; their session log at `/var/lib/xiaowei-workbench/` is **not** migrated.

## Explicitly deferred

| Item | Reason | Trigger to revisit |
|---|---|---|
| `agent/handoff` session event | No current producer; would fail `verify-persistence-catalog` | First ops-runtime orchestrator scenario |
| OPDCA orchestrators (`route_work`, `capability_runner`, `evidence_validator`) | Out of scope per scenario接入 decision | A business scenario explicitly requiring multi-agent handoff |
| Bulk migration of the remaining 13 my-agents business Skills | Defer until per-scenario接入 is proven on one Skill | Next business scenario (e.g. `oa_workbench`, `hr_workbench`, `customer_insight`) |
| Phase 4 Workbench subsystems (conversations, memories, trigger, anomaly, RAG) | Skeletons only; full implementation lands with the consumer | First Workbench surface a scenario needs |
| Phase 5 Electron desktop migration | Replaced by dsh Web frontend served from the ops profile's webserver fallback seat | Done — old Electron app is decommissioned; browser clients load `apps/web/dist` from `http://host:18080/` |
| Phase 6 OTel + Prometheus + production hardening | Independent of agent runtime; deferred | Before opening the product to external traffic |

## Operator pre-flight checklist

Before running `pnpm dsh --profile <profile>`, confirm:

1. `pnpm install` finished without peer-dep warnings about new ops packages.
2. `pnpm run typecheck` reports zero errors.
3. `pnpm run hygiene` reports zero missing-export errors for the new packages.
4. `python3 docs/ops/templates/verify.py` returns three PASS lines.
5. `DEEPSEEK_API_KEY` is set when a real LLM call is needed; the verification smoke does not need it.

## Production deployment — landed

The deploy ran 2026-08-23 against the operator-named target `root@119.45.252.25`, install path `/opt/dsh-ops`, harness home `/var/lib/dsh-ops`. The legacy `xiaowei-*` services were `disable --now`'d before the deploy so port `18000` was free; the previous session log at `/var/lib/xiaowei-workbench/` is left in place but is not read.

What ships in the deploy:

- `scripts/deploy_dsh.sh` — 6-gate rsync-based deploy (preflight / backup / sync / install / restart / health). Idempotent: rerunning overwrites the source tree and restarts the service.
- `/etc/systemd/system/dsh-ops.service` — long-running systemd unit; `pnpm dsh --profile ops`; `Restart=on-failure`, `WatchdogSec=30s`.
- `/var/lib/dsh-ops/profiles/ops/` — Cordis profile directory (`package.json` + `cordis.patch.yml`); the CLI heals `profiles/node_modules/` on launch via `healProfilesModuleFallback`.
- `/var/lib/dsh-ops/sessions/` — durable session log (JSONL); new from scratch per the "重新建一份空 session 日志" directive.

Operational guarantees (today, before any business scenario lands):

1. `dsh-ops --profile ops` boots, the webserver binds `127.0.0.1:18000`, `/health` and `/` return `200`.
2. `systemctl is-active dsh-ops` is `active` after `systemctl restart dsh-ops`, with `NRestarts=0` over a 90s observation window and `uptime_s` growing monotonically (verified post-HMR-disable).
3. `dsh-ops --profile ops --dump-config` lists `@deepseek-ai/dsh-base` then `@deepseek-ai/dsh-ops` layers, with every ops-* plugin row present and `hmr` listed as `disabled: true` (HMR is overridden off because `dsh-base` enables it and prod must not restart on file changes).
4. The Python peer does not yet ship; ops-subagent-python is registered as the provider, but its `--module` defaults to `ops_runtime.subagent_main` (not yet implemented in my-agents). The first scenario that needs the peer implements that module on the Python side.
5. The legacy `xiaowei-*` units remain stopped; reopening them on this host is out of scope.

To redeploy after a code change:

```sh
scripts/deploy_dsh.sh
```

Rollback (named in the deploy script's gate 6 output; uses the `cp -a` backup from gate 2):

```sh
ssh root@119.45.252.25 'systemctl stop dsh-ops && rm -rf /opt/dsh-ops && mv /opt/dsh-ops.bak-<UTC> /opt/dsh-ops && systemctl start dsh-ops'
```

Backup retention is implicit: each deploy leaves `/opt/dsh-ops.bak-<UTC>` until the next deploy's `--delete` rsync trims it. A pre-existing `/opt/dsh-ops.bak-<UTC>` from this run is `/opt/dsh-ops.bak-20260822T170129Z`.

## Phase 5 — web client landed over the ops profile

The operator directive "按照 C 方案落地，我需要彻底升级使用。之前的客户端、用户、数据都可以清掉，不要带有历史包袱" replaced the old Electron desktop with the dsh Web frontend served by the ops profile itself, on the same `127.0.0.1:18000` socket that already carries `/health`.

What changed:

- `@deepseek-ai/dsh-host-frontend-static` added as a peer + dev dependency of `packages/bundle/ops`. Its single `Config.distIndex` is the path to `apps/web/dist/index.html`.
- `packages/bundle/ops/cordis.patch.yml` mounts a new `ops-frontend-static` row right after `ops-webserver`. The `distIndex` is resolved at loader time as `process.cwd() + '/apps/web/dist/index.html'`; the systemd unit pins `WorkingDirectory=/opt/dsh-ops` so the absolute path resolves in production.
- `packages/bundle/ops/src/webserver.ts` no longer registers the `/` exact route. The fallback seat of the webserver (claimed by frontend-static) now serves `index.html` for `/`, and `/health` keeps precedence via its exact registration. SPA assets under `/assets/*` are served by frontend-static's traversal-safe static file handler.
- `scripts/deploy_dsh.sh` rsyncs the built `apps/web/dist/` tree to `/opt/dsh-ops/apps/web/dist/` in gate 3. A locally missing dist is a warning, not a hard fail (frontend-static will 404 until next build).
- Old `xiaowei-app` / `xiaowei-command-worker` / `xiaowei-outbox-worker` systemd units remain `disable --now`'d from the prior run; `/var/lib/dsh-ops/` and `/opt/dsh-ops/` were wiped before this redeploy.

Verification (2026-08-23, post-redeploy):

```sh
$ curl -fsS http://119.45.252.25:18080/health
{"status":"ok","service":"dsh-ops","uptime_s":16}

$ curl -fsS http://119.45.252.25:18080/ | head -8
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="manifest" href="/manifest.webmanifest" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <title>DSH Local Build</title>

$ curl -sI http://119.45.252.25:18080/assets/index-clqxG24t.js
HTTP/1.1 200 OK
content-type: text/javascript; charset=utf-8

$ ssh root@119.45.252.25 'systemctl is-active dsh-ops && systemctl show dsh-ops -p NRestarts --value'
active
0

$ ssh root@119.45.252.25 'cd /opt/dsh-ops && DSH_HOME=/var/lib/dsh-ops pnpm dsh --profile ops --dump-config' | grep -B 1 -A 3 ops-frontend-static
- id: ops-frontend-static
  name: '@deepseek-ai/dsh-host-frontend-static'
  config:
    distIndex: !!js process.cwd() + '/apps/web/dist/index.html'
```

Browser clients point at `http://119.45.252.25:18080/` (the same nginx fronting that was used for the old Electron HTTP API). The nginx upstream is unchanged (`127.0.0.1:18000`); both `/health` and the SPA share the same backend socket.

## Phase 6 — Electron desktop client (PR 7 landed)

The old Electron client has been repurposed (per the operator directive "之前客户端功能直接使用，可以局部改动") and now lives at `apps/desktop/`. It speaks the same dsh RPC envelope and stream frame unions as the dsh web frontend — both surfaces converge on `@deepseek-ai/dsh-host-apiproxy` and the trust-fenced `dsh-client-connection` mount in the ops profile.

### What changed

- **Wire layer** (`PR 4`): REST-style `{ method, path }` requests → dsh `{ type:'client-request', rpcId, method, payload }`. SSE stream (`GET /api/events.mux` / `/api/events.host`) is opened by the main process and fanned as typed IPC events; `X-API-Key` / `X-Tenant-ID` / `X-Actor-ID` headers are gone — the loopback `trustedHosts` fence on `dsh-client-connection` is the only trust gate.
- **Renderer** (`PR 5 + PR 6`): Home / Assistant / Tasks / Approvals / History / Settings — every page calls a thin `api.<group>.<method>(payload)` wrapper that funnels through `window.workbenchApi.request`. The my-agents feature surfaces (telesales, anomalies, triggers, integrations, automations, browser, document-preview, knowledge, resources) are deleted; no shim is left behind.
- **Packaging** (`PR 7`): `electron-builder.yml` rewrites to `appId: com.deepseek-harness.desktop`, `productName: DeepSeek Harness`. Default `product-config.json` points at `http://119.45.252.25:18080/`; override at build time with `WORKBENCH_API_BASE_URL`.

### How to ship

```sh
# Build a release for the operator's machine.
pnpm --filter @deepseek-harness/desktop run package:mac        # arm64 DMG
pnpm --filter @deepseek-harness/desktop run package:mac:x64    # x86_64 DMG
pnpm --filter @deepseek-harness/desktop run package:linux      # AppImage
pnpm --filter @deepseek-harness/desktop run package:win        # NSIS .exe (needs wine on macOS)
```

Latest verification build (2026-08-23):

```text
release/DeepSeek Harness-0.3.0-arm64.dmg       101 MB
release/mac-arm64/DeepSeek Harness.app          bundle, app.asar 26 MB
  CFBundleIdentifier   com.deepseek-harness.desktop
  CFBundleName         DeepSeek Harness
  Resources/product-config.json    {"apiBaseUrl":"http://119.45.252.25:18080"}
```

The local artifact is ad-hoc signed. Public distribution still needs an Apple Developer ID + notarization; on operator machines, Gatekeeper quarantine can be cleared with `xattr -dr com.apple.quarantine "/Applications/DeepSeek Harness.app"`.

### Operator handshake

1. Launch `DeepSeek Harness.app`.
2. Settings page → `baseUrl` field shows the bundled default; press **Probe backend** to confirm `host.describe` returns a model list (this proves `/api/host.describe` reaches `127.0.0.1:18000` through the existing nginx front).
3. Home → **新建会话** → Assistant → type any prompt → response streams over `/api/events.mux`. Pending approvals surface in **待我处理** within ~1 s; `session/jobs` shows in **进行中的任务**.

### Known limits

- The update-checker is a stub until dsh-ops exposes a releases endpoint. The Settings page keeps the affordance; pressing it reports `up-to-date` unconditionally.
- The renderer build emits a `Unrecognized target environment "es2024"` Vite warning (root `tsconfig.base.json`). Harmless for the renderer; surface area is owned by the root config, not the desktop package.
- Packaging on macOS skips code signing (no Developer ID in this environment). Internal-deploy Gatekeeper workaround documented above; public release needs notarization.

## Cross-references

- Deploy skill: [`.agents/skills/dsh-deploy/SKILL.md`](../../.agents/skills/dsh-deploy/SKILL.md)
- Deploy script: [`scripts/deploy_dsh.sh`](../../scripts/deploy_dsh.sh)
- Profile + bundle: [`packages/bundle/ops`](../../packages/bundle/ops/README.md)
- Scenario contract: [`scenario-integration-contract.md`](./scenario-integration-contract.md)
- Templates: [`templates/`](./templates/)
- Deferral note: [`decisions/0001-agent-handoff-event-deferred.md`](./decisions/0001-agent-handoff-event-deferred.md)
- Python peer provider: [`@deepseek-ai/dsh-ops-subagent-python`](../../packages/ops/ops-subagent-python/README.md)
- Bundled Skill provider: [`@deepseek-ai/dsh-ops-skill`](../../packages/ops/ops-skill/README.md)
- Phase 0 example: [`examples/ops-minimal`](../../examples/ops-minimal/README.md)
- Phase 6 Electron client: [`apps/desktop`](../../apps/desktop/README.md)
