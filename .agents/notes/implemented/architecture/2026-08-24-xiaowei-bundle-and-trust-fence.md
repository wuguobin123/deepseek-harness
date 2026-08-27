# Agent Note: xiaowei bundle and authenticated trust fence

Status: implemented

English | [中文](2026-08-24-xiaowei-bundle-and-trust-fence.zh.md)

## Problem

`dsh-xiaowei` is the first bundle in this codebase that runs as a **long-lived multi-user service**. Every prior bundle (`dsh-ops`, `dsh-headless`, `dsh-web-app`) either shipped under loopback or short-lived under a single LAN client. The xiaowei surface accepts requests from anonymous LAN callers (registration is a public endpoint), from signed-in desktop clients (most privileged methods), and from the desktop CDP probe (specific debug methods). Three concerns need to be solved together:

- Which methods a given deployment even exposes — there is no point in letting a LAN caller hit `host.pickDirectory` on a headless server. The fence must enforce that, not just the per-method gate.
- Which authorities a non-loopback deployment treats as trustworthy for the rest of the methods. `trustedHosts` already exists; this PR extends its vocabulary and makes it actually wire-side checked.
- The desktop client's token needs to ride every non-public request without replacing the Host, Origin, or Fetch Metadata checks that prevent browser confused-deputy requests.

## Decision

### Bundle composition

`packages/bundle/xiaowei/cordis.patch.yml` mounts, in dependency order:

1. `storage` + `storage-json` + `storage-domain` — required by session persistence.
2. `session-projection-cache`, `session-reference`, `message-feedback`, `workspace`.
3. `session-persistence-sqlite` — the existing single-file session log.
4. `identity` — `LocalIdentityProvider` from [`2026-08-24-xiaowei-account-seam.md`](2026-08-24-xiaowei-account-seam.md).
5. `email-verification`, `wallet`, `user-model-keys`, `artifact-store-fs`.
6. `api-gateway` — the existing `dsh-host-apiproxy`.
7. `connection` — `dsh-client-connection` with `trustedHosts` derived from `XIAOWEI_TRUSTED_HOSTS` env.
8. `webserver` — `dsh-host-webserver` bound to `XIAOWEI_HOST` / `XIAOWEI_PORT` (default `127.0.0.1:18000`).
9. `frontend-static` — `dsh-host-frontend-static` (gated by `XIAOWEI_SERVE_FRONTEND`).
10. `xiaowei-startup` — publishes the `XIAOWEI_STARTUP_SERVICE` Cordis service consumed by the runner.
11. `xiaowei-runner` — replaces `dsh-headless`'s `headless-startup` (which `program.error`s on empty argv) and `headless-runner` (one-shot foreground task). With empty argv the runner idles; the HTTP `/api/<method>` carrier is what serves the desktop clients.
12. `hmr` is **disabled** — multi-user sessions must not silently restart on file edits, and restarts tear down the bound socket.

### Capabilities advertisement

`host.describe` previously returned only version, cwd, provider, model, attached sessions, home, canOpenPath. The PR adds an **optional** `capabilities` field:

```text
capabilities?: {
  account?: boolean
  wallet?: boolean
  modelKeys?: boolean
  artifact?: boolean
  emailVerification?: boolean
  userContext?: boolean
  e2b?: boolean
}
```

Each flag is `true` only when the matching Cordis service is registered (`ctx.get('identity') !== undefined`, etc.). The desktop renderer reads the field to decide which Settings sections, sidebar entries, and account gates to render at all, so a deployment that doesn't compose `dsh-xiaowei` (e.g. an `dsh-ops` install) reports an absent `capabilities` object and the desktop falls back to the conservative surface. The harness core never reports `capabilities` — bundle authors opt in by publishing them through `XIAOWEI_STARTUP_SERVICE` and reading them in `api-proxy.ts`.

### Authority and authentication

Every HTTP request and WebSocket upgrade first passes `isTrustedApiRequest`: `Host` is loopback or matches `trustedHosts`, attached browser markers are same-origin, and explicit cross-site requests are rejected. Bearer authentication never bypasses these checks.

```ts ignore-check
isTrustedApiRequest(request, trustedHosts)
  && (isPublicMethod(method) || authenticateApiRequest(request, ctx))
```

When identity is mounted, `authenticateApiRequest` extracts `Authorization: Bearer <token>`, validates it through `ctx.identity`, and carries the resulting account principal through unary RPCs and both WebSocket downlinks. `account.signup`, `account.signin`, `account.emailCode`, `account.state`, and `account.signout` remain callable before authentication; every other API method requires a live bearer, including on loopback.

Configuration methods have one additional rule. Without identity, settings and credential reads/writes, model discovery, and agent-preset read/copy/remove stay loopback-only. With identity, a valid account bearer may call them through a declared authority; this is the desktop path that loads and edits the Models page against a remote Xiaowei host. Operations that act on the server machine (`host.pickDirectory`, `host.openPath`, `settings.openDocument`, and `agentPreset.openDocument`) remain loopback-only even for an authenticated account.

### Connection inject

`packages/bundle/xiaowei/cordis.patch.yml` adds `inject: [webRuntime, identity]` to the `connection` row. The fence depends on `ctx.identity` being mounted before its first request, so the dependency injection order matches the actual mount order.

### Production deployment

`scripts/deploy_xiaowei.sh` (separate Agent Note) is the canonical production deploy; it derives `XIAOWEI_TRUSTED_HOSTS` from the SSH target (`127.0.0.1,localhost,<public-ip>`) plus an operator-supplied `XIAOWEI_TRUSTED_HOSTS_EXTRA`, writes the systemd unit, writes the nginx reverse-proxy snippet that maps public `:18080` → loopback `:18000`, and writes the `XIAOWEI_*` env into `/etc/dsh-xiaowei/server.env` (idempotent — only fills keys that are not already present, so a manual secret rotation survives a redeploy).

## Alternatives considered

- **Drop `trustedHosts` and use bearer-only auth** — rejected. A valid token presented through an attacker-controlled Host must not turn the local server into a browser-accessible deputy; authority and same-origin checks remain cumulative with identity.
- **Keep the whole configuration API loopback-only** — rejected. It makes the authenticated remote desktop's Models page fail at `settings.describe`, while the bearer already provides the account identity needed to distinguish that client from an anonymous trusted-host caller. Native host actions remain loopback-only instead.
- **Skip capabilities advertisement, render all sections always** — rejected. The desktop shell today is shared between `dsh-ops` (no `identity`, no `wallet`) and `dsh-xiaowei` (every capability). Always-rendering means the ops install gets broken "Sign in" buttons and "View wallet" cards that 403 on every request. Conditional rendering against `host.describe.capabilities` is the cheapest way to keep the two bundles on one renderer.
- **Inline bearer auth in each privileged method** — rejected. The connection route is the single owner of request identity; scattering token checks across method implementations would make omissions likely and would not attach the principal to WebSocket subscriptions.
- **Single `account.*` super-method with role parameters** — rejected. `signup` / `signin` are public; `wallet.credit` / `modelKeys.revoke` are admin loopback. A single method would need both gates in the body and the parameter dictionary would be the auth surface. Separate methods with the fence enforcing the per-method gate is clearer.

## Consequences

### What this bought

- **One renderer ships for two bundles** — `apps/desktop` works against `dsh-ops` and `dsh-xiaowei` from the same code. The capabilities bit set in `host.describe` is the only signal that distinguishes them.
- **Token propagation is automatic** — every privileged HTTP call from the desktop main process attaches `Authorization: Bearer <token>`; no per-method plumbing.
- **Reachability and identity remain cumulative** — a trusted authority does not authenticate a caller, and a bearer does not override Host or browser-origin rejection.
- **Authenticated remote configuration works** — the desktop can load `settings.describe` and the configurable-provider directory without opening native server-machine actions to the network.
- **Production deploy is one command** — `scripts/deploy_xiaowei.sh` writes systemd, nginx, server.env, and rsyncs the repo in one 6-gate flow mirroring `scripts/deploy_dsh.sh`.

### What this cost

- **Every privileged request takes one Indexed PK lookup** — `sessions.token` lookup on every HTTP request that hits the fence. The cache story (last-seen-at tracking) is a future optimization; this PR does not cache.
- **`XIAOWEI_MASTER_KEY` must be present at deploy time** — the `provision()` fail-loud is the only safe behavior. The deploy script enforces presence.
- **`XIAOWEI_TRUSTED_HOSTS` must include every public authority** — adding a new public hostname (e.g. a `xiaowei.<ip>.nip.io` alias) requires either editing `cordis.patch.yml`'s `trustedHosts` derivation or setting `XIAOWEI_TRUSTED_HOSTS_EXTRA` in `server.env`. The deploy script prints the resolved list at the end so misconfiguration is visible in deploy logs.
- **Every authenticated request performs identity validation** — HTTP calls and WebSocket connection generations validate the session token against the identity store; the implementation does not cache that result.
