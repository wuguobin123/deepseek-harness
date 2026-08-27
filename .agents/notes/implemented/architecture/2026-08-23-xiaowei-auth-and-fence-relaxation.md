# Agent Note: Xiaowei local identity service and bearer-auth fence relaxation

Status: implemented

English | [中文](2026-08-23-xiaowei-auth-and-fence-relaxation.zh.md)

## Problem

The xiaowei deployment (PR 2 step 10.1a) is a multi-user remote backend paired with an Electron desktop client. The privileged-method fence in `packages/client/connection` only admits loopback callers, so the desktop must hit privileged methods either by sitting on the same loopback port or by some other trusted-identity mechanism. Loopback-only also blocks any non-loopback LAN deployment and any future remote frontend. Without a real identity service, the wire has no way to authenticate the LAN caller that just signed up, and `account.signup` itself cannot land without an auth path that crosses the fence.

Three sub-decisions follow. Where does identity live — separate `account-identity` definition and `account-identity-local` provider packages, or one package with both roles? Where does the user/session table live — re-use `ctx.storage` and the `storage-sqlite` hub, or open a private SQLite file at `<dshHome>/identity.sqlite`? What does the fence accept — pure loopback, pure bearer, or "loopback OR bearer"? The token transport between the desktop main process and the local API server, and the password hashing choice, follow from those.

## Decision

The xiaowei remote-backend PR (10.1a) ships one package `packages/account/identity` (`@deepseek-ai/dsh-account-identity`) that default-exports `LocalIdentityProvider extends IdentityService`. `IdentityService` is the Cordis `Service` subclass owning `ctx.identity`; `LocalIdentityProvider` is the only implementation in the tree. Both roles live in one package, single-package pre-release stance — rename/repackage freely and update every reference together.

The provider opens `<dshHome>/identity.sqlite` directly via Node `node:sqlite` `DatabaseSync`, sets `journal_mode = WAL`, `PRAGMA application_id`, `PRAGMA user_version`, and ensures the parent directory is `0o700` and the file `0o600`. The schema is two tables (`users` with `UNIQUE(email)`, `sessions` with `FK(user_id) ON DELETE CASCADE`) plus one supporting index. No `ctx.storage` hub: the local identity table has its own write/read pattern (one row per signup, one row per session) and `users.sessions` cascades through `user_id`, so a shared KV/JSON store would not express the relationship cleanly. The schema mirror is `packages/storage/storage-sqlite/src/schema.ts:43-50`.

The wire exposes four non-privileged methods: `account.signup`, `account.signin`, `account.signout`, `account.state`. None of them appear in `PRIVILEGED_METHODS`. The fence in `packages/client/connection/src/index.ts` becomes `!(isTrustedApiRequest(request, []) || isAuthenticatedApiRequest(request, ctx))` for both HTTP and the WebSocket upgrade path. `isAuthenticatedApiRequest` reads `Authorization: Bearer <token>`, calls `ctx.identity.validate({ sessionToken })`, and returns `true` only when the service resolves a non-null `{ userId, displayName }`. The trust table therefore reads as "loopback OR known bearer".

Passwords are hashed with Node `crypto.scrypt` using `N=16384, r=8, p=1`, a 16-byte `randomBytes` salt, and a 64-byte derived key. The on-disk format encodes the parameters: `scrypt$N=16384$r=8$p=1$<salt-base64url>$<hash-base64url>`. Comparisons use `crypto.timingSafeEqual` and never `===`. The provider rejects unknown parameter strings with a typed `IdentityError('BAD_REQUEST')`.

`LocalIdentityProvider` exposes:

- `signup({ email, password, displayName? }): { userId, sessionToken, displayName, expiresAt }` — `EMAIL_TAKEN` on `UNIQUE` violation
- `signin({ email, password }): { userId, sessionToken, displayName, expiresAt }` — `UNAUTHENTICATED` for unknown email or wrong password (same code, no oracle)
- `signout({ sessionToken }): { revoked: true }` — idempotent on unknown tokens
- `validate({ sessionToken }): { userId, displayName } | null` — `null` for revoked, expired, or unknown tokens

The token store deletes the row on `signout`. The fence looks the token up synchronously against the live SQLite row, so revocation takes effect on the very next request without any cache invalidation.

Bootstrap defaults to `{ email: '', password: '' }` (no admin). When the `users` table is empty on init and `bootstrap.email` is configured, the provider creates exactly one admin row using the same scrypt path and logs an `INFO identity: bootstrap user created (email=...)`. A second mount over the same database does NOT re-bootstrap; the empty-table gate prevents duplicate admin rows even when the bootstrap config is still present. The default empty bootstrap leaves signup open.

The desktop token transport (`apps/desktop/src/main/credential-store.ts`) bumps `PersistedCredentials` from v2 to v3, adding optional `sessionToken` / `userId` / `displayName` / `expiresAt` fields. The v3 reader treats missing legacy fields as empty strings (not errors) — a v2 file upgrades to v3 in place without losing the prior `baseUrl`. `apps/desktop/src/main/api-client.ts` gains `setToken(t: string | null)` and attaches `Authorization: Bearer <t>` on every `call()` / `respond()` fetch when `t !== null`; `setToken(null)` clears the header.

The Electron main process IPC bridge gains four keys (`getAuthState`, `signIn`, `signOut`, `subscribeAuthState`) backed by `workbench:auth:*` channels in `apps/desktop/src/shared/contracts.ts` and `apps/desktop/src/main/ipc-handlers.ts`. On successful sign-in the handler writes through `credentialStore.save()`, calls `apiClient.setToken(result.sessionToken)`, and broadcasts an `AuthStateEvent` to the renderer. The renderer exposes `api.auth.{getState,signIn,signOut,subscribe}` from `apps/desktop/src/renderer/api.ts` and ships a `SignInCard` cold-start UI that submits to `api.auth.signIn`.

The WebSocket privileged path (mux/host upgrade at `packages/client/connection/src/index.ts:181-190`) keeps `isTrustedApiRequest` only — `isAuthenticatedApiRequest` does not run there. WS upgrades carry server→client event streams, not user method calls, so bearer validation would only buy observability for now. The mechanism is wired (the connection plugin already injects `identity`) so the next per-user event-subscription feature can switch it on without touching the fence.

Wallet (`WalletService`) and `UserModelKeyService` are not in this PR. `account.signup` does not allocate a `welcome` 20-yuan quota; `account.wallet.*` and `account.modelKeys.*` wire methods do not exist. PR 2 step 10.1b patches `signup` to call `provisionUserKey` + `setQuota(welcome)` once those packages land.

## Alternatives considered

**Two packages: `account-identity` (Service Definition) + `account-identity-local` (Provider).** [Capability seams](2026-06-13-capability-seams.md) normally splits Service Definition from Service Provider into separate packages when they evolve independently. The pre-release stance section in `AGENTS.md` lets us combine when no second provider exists yet, and there is no second provider in the tree today. Splitting would add a package, an aggregate registration, and a test fixture with zero observable behavior change. The single-package shape is the seam in its folded form; the split lands the day a remote/OIDC provider appears.

**Route identity through `ctx.storage` and `storage-sqlite`.** A general-purpose KV/blob store would lose the `users.email UNIQUE` and `sessions.user_id FK ON DELETE CASCADE` relationships. Encoding them as compound keys or duplicating index logic in the identity package is more code than running a focused SQLite DDL. `ctx.storage` is the right surface for opaque blobs and per-key documents; identity has a relation it can express in SQL.

**Hard-block all non-loopback callers; sign-in via WebSocket upgrade that bypasses the fence.** The WS upgrade is already loopback-or-trustedHosts; turning it into the only auth path forces the desktop client to open an out-of-band upgrade channel before any privileged method call. Worse, it does not generalize to a remote LAN frontend where the WS layer has to terminate on the public side. Bearer auth on the existing HTTP fence keeps the surface area smaller.

**Keep `account.signup` privileged (require an admin bearer to create new users).** First-deploy and self-hosted xiaowei deployments have no admin to create the first user. `account.signup` is intentionally a non-privileged method so a fresh deployment can take its first signup without first running an offline bootstrap dance. The bootstrap path inside the provider covers the "provisioned default admin" case. Banning signup later (per-tenant disable, rate limit) belongs in a future privileged `account.admin.*` surface, not in the fence.

**Argon2 / bcrypt for password hashing.** Both pull a new native dependency and either a build step or a precompiled binary. `crypto.scrypt` is in Node stdlib, ships with the engine, and is FIPS-compatible. `N=16384` is the published OWASP 2023 floor; the on-disk `scrypt$N=...$...` format already parameterizes the cost, so a future migration to `N=2^17` is a verifier change rather than a wire change.

**Cache bearer tokens in process for sub-millisecond fence checks.** The fence looks the token up against the live SQLite row on every privileged request. The cost is one indexed PK lookup per request; the benefit is that `account.signout` and session expiry are observed immediately. A cache would introduce a stale window between revocation and effect, which the security boundary does not accept.

**Validate bearer on the WebSocket upgrade.** The upgrade today carries server→client event streams, not user method calls. Adding `isAuthenticatedApiRequest` to the upgrade buys observability but no security boundary — the server side still has to look up `mux.subscribe(sessionId)` against the eventual session. The mechanism is in place; per-user subscription lands with the subscription feature, not the fence.

## Consequences

`packages/account/identity` is the single owner of user and session rows for xiaowei deployments. The fence admits loopback callers (unchanged) and bearer callers whose session token resolves to a non-null identity. Anonymous LAN callers can call `account.signup`, `account.signin`, `account.signout`, `account.state` without a bearer; every other privileged method still requires either loopback or bearer. Desktop clients persist the token via `safeStorage`-encrypted v3 credentials and re-attach it on every fetch; clearing the token clears the header.

The fence reads every privileged request against the live SQLite row, so revocation is observed on the very next privileged request. The cost is one PK lookup per privileged call (a few hundred microseconds on the dev box). This is acceptable for the xiaowei deployment scale; a 30-second `last_seen_at` heartbeat can move to a write-through cache later if the profile shows pressure.

PR 2 step 10.1b (wallet + model-keys) will land `WalletService` and `UserModelKeyService` as separate packages following the same definition + provider shape. `signup` will gain a `provisionUserKey` + `setQuota(welcome)` step at the end of the existing transaction. The wire will gain `account.wallet.*` and `account.modelKeys.*` methods, all privileged-loopback-only until a public-read surface is justified.

## Testing

- `packages/client/connection/tests/api-request-auth.spec.ts` — eight `extractBearerToken` cases (valid header, trimmed, Headers object, missing header, non-Bearer scheme, empty token, multi-value header, case-insensitive scheme) and five `isAuthenticatedApiRequest` cases (live token, missing header, missing service, validate returns null, validate throws).
- `scripts/xiaowei/sanity-account-signup.mjs` — eleven steps over real on-disk SQLite: schema lands, signup, duplicate `EMAIL_TAKEN`, wrong password `UNAUTHENTICATED`, unknown email `UNAUTHENTICATED`, signin issues a fresh token, both live tokens validate, signout revokes the first, the second survives, idempotent signout, token survives a provider restart.
- `scripts/xiaowei/sanity-bootstrap-user.mjs` — four steps: empty-bootstrap deployment rejects signin, configured bootstrap creates the admin, a second mount does NOT re-bootstrap, empty bootstrap leaves signup open.
- `scripts/xiaowei/sanity-fence-relaxation.mjs` — seven steps over a real Node `http.Server`: loopback caller passes the fence, trusted host without token returns 403, trusted host + valid bearer passes the fence, trusted host + tampered bearer returns 403, trusted host + revoked bearer returns 403, malformed Authorization values return 403.

## Deferred

- Wallet (`WalletService`) and `UserModelKeyService` — PR 2 step 10.1b.
- `account.wallet.setQuota` / `account.admin.*` privileged-loopback-only methods — landing with the wallet packages.
- WebSocket bearer validation — landing with the per-user event-subscription feature.
- Linux `secret-service` fallback for `safeStorage` — out of scope; current baseline throws on missing backend.
- `last_seen_at` write-through cache for the fence — added if the xiaowei deployment profile shows pressure.

## Related

- [Capability seams — Service Definition / Service Provider / Consumer roles](2026-06-13-capability-seams.md)
- `packages/account/identity/` — the shipped package
- `packages/client/connection/src/api-request-auth.ts` — bearer extraction + identity validation
- `packages/client/connection/src/index.ts` — the relaxed fence
- `apps/desktop/src/main/credential-store.ts` — v3 schema and `safeStorage` upgrade path
- `apps/desktop/src/main/api-client.ts` — `setToken` and Authorization header