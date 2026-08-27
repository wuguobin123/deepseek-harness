# Agent Note: xiaowei wallet + model-keys + email-verification packages

Status: implemented

English | [中文](2026-08-23-xiaowei-wallet-model-keys.zh.md)

## Problem

The xiaowei capability layer (PR 2 of the xiaowei plan) needs three new account-side packages that were originally deferred from PR 2 step 10.1a:

- A **wallet** that tracks per-user CNY-denominated balance in micros (`balance_micros / 1_000_000 = CNY`), with welcome bonus, daily refresh, admin quota overrides, and a complete audit ledger. The my-agents reference pattern is `model_accounts.py:1139-1203` (`set_wallet_quota`).
- A **user-model-keys** service that provisions one `mk_<…>` identifier and one `sk_<…>` cleartext key value per user, encrypts the key value at rest with AES-256-GCM, and revokes / reprovisions under a master-key policy. Reference pattern: `model_accounts.py:441-517` (`provision_user_key`).
- An **email-verification** flow (6-digit code, 10-minute TTL, 60-second resend cooldown, 5-attempt lockout) that gates `account.signup` when enabled. Reference: `email_verification.py`.

Three concrete decisions needed resolution up front:

1. Whether the abstract Service Definition and its sole implementation live in one package (pre-release stance) or split into abstract + provider.
2. Whether the on-disk SQLite database reuses `identity.sqlite` (one financial/lifecycle file) or gets its own file per concern (separate lifecycle / backup granularity / application id).
3. Whether `provision()` returns the cleartext key value once and only once (subsequent reads return metadata only), and how the master-key `XIAOWEI_MASTER_KEY` is plumbed.

## Decision

### Single-package abstract + implementation

All three packages — `packages/account/email-verification/`, `packages/account/wallet/`, `packages/account/model-keys/` — colocate the abstract Service Definition and its sole SQLite-backed implementation in one `*.ts` (default export = the concrete class). This mirrors the pre-release stance already taken by `packages/account/identity/` and `packages/session/session-persistence-sqlite/`. The Loader picks the default export; an alternative provider would ship as a sibling package with a different default class and a different `cordis.yml` row.

### Independent SQLite files per concern

| Package | Path | `SCHEMA_VERSION` | `APPLICATION_ID` |
|---|---|---|---|
| `identity` | `<dshHome>/identity.sqlite` | 1 | distinct |
| `email-verification` | reuses `identity.sqlite` (DDL appended) | n/a (additive) | shared |
| `wallet` | `<dshHome>/wallet.sqlite` | 1 | distinct |
| `user-model-keys` | `<dshHome>/user-model-keys.sqlite` | 1 | distinct |

`email-verification` reuses the identity file because its row lifecycle is short (minutes to hours) and the verification table is a side-channel to `account.signup` — splitting it would force cross-database FK semantics for no operational benefit. The wallet and model-keys files are independent because they are financial / credential material with longer lifetimes, distinct backup requirements, and the ability to wipe a key store without touching the identity roster.

### Currency: micros, no float

`WalletView.balanceMicros` is `number` in micros. 1 000 000 micros = 1.00 CNY. No float math on the wire; the renderer converts via `Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' })`. The unit is named in every error message and every ledger entry column.

### Ledger uniqueness via partial index

```sql
CREATE UNIQUE INDEX IF NOT EXISTS wallet_ledger_idem
  ON wallet_ledger(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
```

`refreshDaily({ userId, idempotencyKey: 'YYYY-MM-DD' })` writes the ledger row inside `BEGIN IMMEDIATE`; a second call with the same key either matches (no-op, returns current balance) or conflicts with `SQLITE_CONSTRAINT_UNIQUE` (caller surfaces `DUPLICATE_REFRESH`). Daily refresh is therefore exactly-once per `(userId, date)`.

`debit()` over-balance throws `WalletError('INSUFFICIENT_BALANCE')` inside the same transaction; the row writes are reverted by the implicit rollback so the audit log never records a negative balance.

### Encrypted key material

`LocalUserModelKeyProvider.provision({ userId })`:

- Generates `mk_<16 hex>` and `key_value = randomBytes(32).toString('base64url')`.
- Encrypts `key_value` with `crypto.createCipheriv('aes-256-gcm', masterKey, iv12)`, stores `iv || tag || ciphertext` as a single BLOB.
- Returns `{ keyId, userId, label, createdAt, keyValue }` — the cleartext is exposed exactly once at the call site.
- `list({ userId })` returns `{ keyId, userId, label, createdAt, lastUsedAt, revokedAt }` only — never the keyValue, ever.
- `revoke({ keyId })` sets `revoked_at`; subsequent `provision()` for the same user mints a fresh key id (the slot is freed).
- Missing `XIAOWEI_MASTER_KEY` fails loud at first `provision()` call: `ModelKeyError('MASTER_KEY_NOT_CONFIGURED', …)`. No silent fallback.

### `LoggingEmailSender` capture mechanism

The email-verification provider exposes a structural `SenderLogger` contract (`info` / `warn`). `LoggingEmailSender` is the default fallback when `transportKind !== 'smtp'`; `SmtpEmailSender` is constructed lazily and only when SMTP env is set so a no-SMTP deployment never imports `nodemailer`. `enabled: false` short-circuits both `requestCode` (throws `EMAIL_VERIFICATION_DISABLED`) and `verifyCode` (pass-through, returns `true`) so an operator can disable the seam without re-deploying code.

### Cordis bundle wiring

`packages/bundle/ops/cordis.patch.yml` and `packages/bundle/web-app/cordis.patch.yml` add three rows after the existing `identity` row:

- `email-verification` reads `XIAOWEI_SMTP_HOST` env. If set → SMTP transport; otherwise → logging. `XIAOWEI_EMAIL_VERIFICATION=false` disables the seam entirely.
- `wallet` configures `welcomeBonusMicros: 20_000_000`, `dailyRefreshMicros: 0` by default (opt-in through `XIAOWEI_DAILY_REFRESH_MICROS`).
- `user-model-keys` reads `XIAOWEI_MASTER_KEY` (32-byte base64url).

The `connection` row's `inject` list is extended to `[webRuntime, identity, emailVerification, wallet, userModelKeys]`.

### Wire methods + fence

`packages/host/apiproxy/src/api/account.ts` exposes:

- `account.emailCode` (public, non-privileged; trusts the caller but is rate-limited at the seam via cooldown + per-hour cap).
- `account.wallet.{get,credit,debit,setQuota,refreshDaily, grantWelcomeBonus,listLedger}` — `credit`, `debit`, `setQuota`, `refreshDaily`, `grantWelcomeBonus` are **loopback-only**; `get` and `listLedger` are **loopback OR bearer** with `userId === token.userId`.
- `account.modelKeys.{provision,list,revoke}` — `provision` and `revoke` are **loopback-only**; `list` is **loopback OR bearer** with the same `userId === token.userId` check.

`IdentityError`/`WalletError`/`ModelKeyError`/`EmailVerificationError` are surfaced via `errorToRpc()` with `code` chosen from the `{internal, bad-request, too-many-requests, unauthenticated, forbidden}` set. `INSUFFICIENT_BALANCE` → `bad-request`; `WRONG_CODE`/`CODE_EXPIRED`/`CODE_LOCKED`/`CODE_NOT_FOUND` → `bad-request`; `RESEND_COOLDOWN`/`RATE_LIMIT_EXCEEDED` → `too-many-requests`.

### Sanity scripts

`scripts/xiaowei/{sanity-wallet-quota,sanity-model-keys, sanity-email-code}.mjs` exercise the public surface end-to-end against a real on-disk SQLite file in a temp directory:

- `sanity-wallet-quota`: fresh-user zero → setQuota → credit → debit → over-balance → daily-refresh idempotent → listLedger newest-first → restart-persistence → grantWelcomeBonus on a different user.
- `sanity-model-keys`: provision → second-provision `KEY_REVOKED` → list (no cleartext leakage) → revoke → list shows `revokedAt` → reprovision → revoke(unknown) → revoke(revoked) → restart-persistence → empty master key `MASTER_KEY_NOT_CONFIGURED`.
- `sanity-email-code`: requestCode ttl + retryAfter → resend cooldown → 5 wrong codes `CODE_LOCKED` → correct code while locked still locked → verify success deletes row → TTL expiry → unknown email `CODE_NOT_FOUND` → disabled seam pass-through.

The scripts depend on workspace packages; `scripts/package.json` + `pnpm-workspace.yaml` add `scripts` as a workspace member so `pnpm exec tsx scripts/xiaowei/sanity-*.mjs` resolves the packages through workspace symlinks. The `Branded<UserId>` brand is consumed via a plain-string cast helper at the script boundary (the brand is applied at the package seam, not constructed at the test site).

## Alternatives considered

**Split abstract + implementation into separate packages** (e.g. `account-wallet` and `account-wallet-local`). Rejected: pre-release stance; the codebase already ships single-package Service Definitions under the same rule; no current consumer needs a second provider.

**Reuse `identity.sqlite` for wallet + model-keys.** Rejected: financial and credential material have distinct backup / wipe semantics; sharing one file makes it impossible to rotate the key store independently of the user roster, and SQLite WAL checkpoint ordering becomes ambiguous.

**Float `balanceCny` on the wire.** Rejected: float JSON loses precision (`0.1 + 0.2 ≠ 0.3`); the renderer formats with `Intl` from a micros integer. Micros is the unit, currency is the presentation.

**Cleartext key value stored in `key_value` column.** Rejected: an operator copying the file to a backup medium sees the key. AES-GCM keeps the cleartext out of every layer that does not possess the master key.

**Provision returns key value on every read.** Rejected: an audit log or dashboard that calls `list()` would then have the cleartext on hand, increasing the leak surface. The cleartext is exposed exactly once at `provision()` time; subsequent reads are metadata only.

**In-process `logging` transport in production.** Acceptable but explicitly demoted: `LoggingEmailSender` is the default fallback when no SMTP env is configured, and is intended for dev / CI. Production deploys set `XIAOWEI_SMTP_HOST` etc. and the bundle patch routes through `SmtpEmailSender` instead.

**Add argon2 / bcrypt dependencies for password / code hashing.** Rejected: the repo's pre-release stance favors Node stdlib (`crypto.scrypt` for passwords, `crypto.pbkdf2Sync` for verification codes with 200 000 iterations) — both are sufficient at the chosen parameters and avoid new transitive supply-chain surface.

## Consequences

- Single-file SQLite per concern keeps DDL small, backups independent, and dispose ordering explicit (each provider yields a `store.close()` disposer).
- `Branded<UserId>` is the wire seam's brand; sanity scripts cast plain strings to the brand at the call site because the brand type from `@deepseek-ai/dsh-brand` is type-only and not a function.
- `LoggingEmailSender`'s constructor captures `ctx.logger` by reference; test capture must replace `ctx.logger.warn` **before** `ctx.plugin(...)` — installing the capture after the plugin loads is too late (the sender has already snapshotted the original).
- The wallet / model-keys providers each own one `node:sqlite` handle; concurrent `credit`/`debit` calls on the same user are serialized by SQLite's per-database write lock + the `BEGIN IMMEDIATE` transaction.
- API key cleartext is exposed exactly once at provision time; UI flows that need to display it (e.g. "copy to clipboard" button) must do so immediately after the wire response, not re-fetched from `list`.
- `XIAOWEI_MASTER_KEY` rotation requires a re-encrypt migration: the schema reserves `master_key_version` for a future bump; this PR does not implement rotation.
