# Agent Note: xiaowei account seam — identity, email-verification, wallet, model-keys

Status: implemented

English | [中文](2026-08-24-xiaowei-account-seam.zh.md)

## Problem

The xiaowei multi-user surface needs four cooperating primitives:

1. **Identity** — durable users with password login, server-issued session tokens, and revoke-on-signout semantics. Without it there is no per-user separation, no welcome bonus chain, and no fence exemption.
2. **Email verification** — registration must verify the email is reachable (anti-abuse, anti-typo); the classic 6-digit code with TTL, resend cooldown, and lockout window.
3. **Wallet** — per-user balance in micros with a complete ledger for audit; signup must credit a 20-CNY welcome bonus; ops must be able to top up and set quota.
4. **User model keys** — per-user API key for the new-api protocol; encrypted at rest with a master key from env, only revealed in plaintext exactly once at provisioning.

Each of these primitives has at least one obvious wrong shape: a single shared SQLite hub that does not match the access pattern, an external auth provider that drags an HTTP round-trip into every privileged request, or a third-party password-hashing library that adds a dependency for the same Node stdlib can do. The notes below name what was actually shipped and why.

## Decision

Four Cordis `Service`s mounted by `dsh-xiaowei` as four single-file SQLite stores under `DSH_HOME`. Pre-release stance: each Service Definition **and** its only concrete implementation live in one package; no `*-local` sibling. The fence gate is `loopback OR trustedHosts OR isAuthenticatedApiRequest`; the last predicate is added in this PR and is documented in [`2026-08-24-xiaowei-bundle-and-trust-fence.md`](2026-08-24-xiaowei-bundle-and-trust-fence.md). The `account.signup` trigger chain is `welcome credit → provision user model key → return`, with key provisioning best-effort so a transient key-store failure does not roll back signup.

### 1. Identity

`packages/account/identity/` exports `IdentityService` (abstract) and `LocalIdentityProvider` (default export concrete). One SQLite file `<dshHome>/identity.sqlite`, `journal_mode = WAL`, file mode `0o600`, parent dir `0o700`, `SCHEMA_VERSION = 1`. Two tables:

- `users(user_id PRIMARY KEY, email UNIQUE, password_hash, display_name, created_at)`
- `sessions(token PRIMARY KEY, user_id FK ON DELETE CASCADE, created_at, expires_at, last_seen_at, user_agent)`

Password hashing: Node stdlib `crypto.scrypt` with `N=16384, r=8, p=1`, 16-byte salt, 64-byte hash. Storage format `scrypt$N=16384$r=8$p=1$<salt-base64url>$<hash-base64url>`. Comparison via `crypto.timingSafeEqual`, never `===`. Token format `randomBytes(32).toString('base64url')`.

`LocalIdentityProvider.signup()` runs: schema check → optional email-verification gate (when `ctx.emailVerification.enabled`) → create user → mint session → fire welcome bonus → provision user model key (best-effort) → return `SignedIn`. Bootstrap: if `users` is empty AND `XIAOWEI_ADMIN_EMAIL`/`XIAOWEI_ADMIN_PASSWORD` are set, create that user on `[Service.init]` and log INFO; empty users + empty bootstrap is normal startup.

### 2. Email verification

`packages/account/email-verification/` exports `EmailVerificationService` and `LocalEmailVerificationProvider`. Reuses `identity.sqlite` (one table `email_verification_codes`), so operational lifecycle stays tied to the user table; `wallet.sqlite` and `user-model-keys.sqlite` are intentionally separate (see §3, §4).

- 6-digit numeric code, 10-minute TTL, 60-second resend cooldown, 5 wrong attempts before 30-minute lockout, 10 sends/hour.
- Hash: `crypto.pbkdf2Sync('sha256', 200_000 iterations, salt=16B, keylen=32B)`. The 6-digit search space is small enough that PBKDF2 cost is acceptable; scrypt is reserved for the password.
- EmailSender abstraction with two impls: `LoggingEmailSender` (default; prints raw code to stderr at WARN level — the desktop CDP probe can grep it) and `SmtpEmailSender` via `nodemailer`.
- ESC channel: `config.enabled = false` (`XIAOWEI_EMAIL_VERIFICATION=false`) skips the table creation, the verification gate inside `signup()`, and the entire wire method; the route stays compiled but the handler returns a clear `VERIFICATION_DISABLED` code.
- Error codes: `WRONG_CODE` / `CODE_EXPIRED` / `CODE_LOCKED` / `CODE_NOT_FOUND` / `EMAIL_INVALID` / `RESEND_COOLDOWN` / `RATE_LIMIT_EXCEEDED`. Wire mapping: the first five → `code: 'bad-request'` (HTTP 400); the last two → `code: 'too-many-requests'` (HTTP 429).

### 3. Wallet

`packages/account/wallet/` exports `WalletService` and `LocalWalletProvider`. Independent SQLite file `<dshHome>/wallet.sqlite`, `SCHEMA_VERSION = 1`. Two tables:

- `wallets(user_id PRIMARY KEY, balance_micros, updated_at, created_at)`
- `wallet_ledger(id PK AUTOINCREMENT, user_id, delta_micros, reason, balance_after, created_at, idempotency_key NULL)` with `UNIQUE(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL`.

Unit `balance_micros / 1_000_000 = CNY` is the same convention as the my-agents Python peer; UI converts via `Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' })`. Config defaults: `welcomeBonusMicros: 20_000_000` (20 CNY), `dailyRefreshMicros: 5_000_000` (5 CNY). `credit()` / `debit()` run inside `BEGIN IMMEDIATE` transactions covering `UPDATE wallets` + `INSERT ledger`; `debit()` throws `INSUFFICIENT_BALANCE` when the row would go negative. Daily refresh uses `idempotencyKey = 'YYYY-MM-DD'` and the UNIQUE index ensures a second call on the same day is a no-op.

### 4. User model keys

`packages/account/model-keys/` exports `UserModelKeyService` and `LocalUserModelKeyProvider`. Independent SQLite file `<dshHome>/user-model-keys.sqlite`, `SCHEMA_VERSION = 1`. One table `user_model_keys(key_id PK, user_id, key_value_encrypted, label, created_at, last_used_at, revoked_at)`.

- `provision({ userId })` generates `mk_` + 16 hex for the visible key id and a 32-byte secret stringified as `base64url`. The secret is encrypted with AES-256-GCM (master key = `XIAOWEI_MASTER_KEY` env, 32-byte base64url); the master key is checked at `[Service.init]` and a missing key is a fail-loud error (`MASTER_KEY_NOT_CONFIGURED`).
- The plaintext `keyValue` is returned exactly once, in the `provision()` response. `list()` and `get()` return only `keyId` + metadata. The secret is never stored, logged, or returned again.
- `revoke({ keyId })` sets `revoked_at`; subsequent `provision()` calls do not reuse old key ids.

### Fence (delegated to the bundle note)

`account.signup` / `account.signin` / `account.signout` are not in `PRIVILEGED_METHODS`. They are gated by `isTrustedApiRequest` (loopback or `trustedHosts`) and additionally require a valid `Authorization: Bearer <token>` only on `account.signout`; `signup`/`signin` are the token-mint endpoints themselves.

`account.wallet.credit` / `account.wallet.setQuota` / `account.modelKeys.provision` / `account.modelKeys.revoke` are loopback-only (privileged methods). `account.wallet.get` / `account.modelKeys.list` accept bearer where `userId === token.userId` (the cross-user read returns 403).

## Alternatives considered

- **Argon2 / bcrypt password hashing** — rejected; the cost-vs-dependency tradeoff for an 8-character minimum is unacceptable. Node `crypto.scrypt` is stdlib, has the same memory-hard properties, and `crypto.timingSafeEqual` covers the constant-time compare.
- **`bcrypt` / `argon2id` external dep for verification code** — rejected; PBKDF2 at 200 000 iterations is enough for a 6-digit search space and avoids a parallel hashing library. The library's stronger guarantees would be wasted on a 10-minute TTL.
- **One SQLite file for all three (identity + wallet + model-keys)** — rejected; `wallet` and `user-model-keys` have different operational lifecycles (rotation, backup granularity, audit window) than identity, and a `BEGIN IMMEDIATE` that spans `users` + `wallets` is a coupling the harness should not take on. `email-verification` reuses `identity.sqlite` because its lifecycle is bound to the user table.
- **External auth provider (Auth0 / Supabase / Keycloak)** — rejected; an HTTP round-trip per privileged request is not a sustainable cost. The token revocation guarantee (immediate, synchronous SQLite lookup on every fence check) is the central property of the trust model and it must stay in-process.
- **JWT signed tokens** — rejected; an opaque server-issued token that is `SELECT`ed against `sessions` on every fence check gives immediate revocation at the cost of one indexed PK lookup. JWT's revocation story is "wait for the expiry" or maintain a deny list anyway.
- **`password_hash` / `password_verify` PHP-style library** — rejected; same Node stdlib argument. scrypt's encoding includes parameters, so a future parameter upgrade is a verify-compatible upgrade.
- **Allowing bearer auth to bypass `trustedHosts`** — rejected; the fence is layered. Trusted-hosts is reachability (which deployments can talk to this host); bearer auth is identity (which user is calling). The two layers compose: a non-trusted source still needs a valid token, and a trusted source without a token still gets through.

## Consequences

### What this bought

- **Independence** — each service owns one file; backup granularity, WAL lifecycle, and disposal ordering are per-service.
- **Zero new runtime deps** — `crypto.scrypt`, `crypto.pbkdf2Sync`, `crypto.createCipheriv('aes-256-gcm')`, `crypto.timingSafeEqual`, `node:sqlite`. The only new dep is `nodemailer` for SMTP (one workspace dep, optional).
- **Immediate revocation** — `account.signout` is a row delete; the fence checks the row on every privileged request.
- **Single deploy artifact** — one `pnpm dsh --profile xiaowei` boots all four services, no external auth provider required.
- **Operationally bounded quota** — 20 CNY welcome, 5 CNY daily refresh, idempotent by day; admin setQuota via loopback.

### What this cost

- **Per-request fence lookup** — every privileged request takes one indexed PK query on `sessions`. Acceptable; not cached. Future caching must keep the revocation guarantee.
- **Best-effort key provision on signup** — if `user-model-keys.provision` fails after the wallet credit has been written, the user is created and credited but no key exists. The desktop UI surfaces this; the user retries `account.modelKeys.provision` from settings. Mitigation: log a WARNING, do not roll back the signup, because rolling back a user who already saw the welcome screen is a worse user experience than asking them to retry a key creation.
- **`MASTER_KEY` rotation requires a re-encrypt pass** — the AES-GCM ciphertext uses one master key. Rotation is a manual `UPDATE user_model_keys SET key_value_encrypted = reencrypt(key_value_encrypted, OLD_KEY, NEW_KEY)` followed by env swap; not automated in this PR.
- **WS bearer auth is out of scope** — only HTTP unary methods are validated against the token. The `events.mux` / `events.host` WebSocket downgrade streams are trusted-host only; per-user event subscription is a future PR.
- **Linux desktop `safeStorage` unavailable** — the desktop credential store still throws if `safeStorage.isEncryptionAvailable()` is false on Linux without secret-service. The token is not persisted on those hosts; users sign in every launch. Future PR.
- **`account.emailCode` is reachable from any LAN caller through the fence** — there is no IP-based rate limit in this PR. A future PR adds per-IP rate limiting + Turnstile.
- **`account.signup` exposed to LAN callers** — any client whose source passes `trustedHosts` (loopback + public IP) can mint accounts. No admin-only signup mode in this PR; an `account.admin.*` privileged set is a future PR.
