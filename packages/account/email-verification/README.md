# `@deepseek-ai/dsh-account-email-verification`

English | [中文](README.zh.md)

Email verification code seam for xiaowei signup. Mounts as `ctx.emailVerification`; the wire methods in `packages/host/apiproxy/src/api/account.ts` call it from `account.signup` (verify) and `account.emailCode` (send).

## Behavior

| Method | Purpose | Errors |
| --- | --- | --- |
| `requestCode({ email, purpose?, invitationId? })` | Mint and dispatch a fresh 6-digit code bound to one purpose and invitation | `EMAIL_INVALID`, `CODE_LOCKED`, `RATE_LIMIT_EXCEEDED`, `RESEND_COOLDOWN`, `EMAIL_VERIFICATION_DISABLED` |
| `verifyCode({ email, code, purpose?, invitationId? })` | Verify and delete only the matching bound code | `EMAIL_INVALID`, `CODE_NOT_FOUND`, `WRONG_CODE`, `CODE_EXPIRED`, `CODE_LOCKED` |

Tunables (defaults shown):

| Config | Default | Effect |
| --- | --- | --- |
| `enabled` | `true` | Master kill switch; `false` makes `verifyCode` a no-op |
| `ttlSeconds` | `600` | Code lifetime |
| `resendCooldownSeconds` | `60` | Minimum gap between two sends to the same email |
| `maxSendsPerHour` | `10` | Rolling per-email cap |
| `maxAttemptsBeforeLock` | `5` | Wrong-code threshold |
| `lockoutSeconds` | `1800` | Lockout duration after threshold |
| `transportKind` | `logging` | Sender; `smtp` for production |

## Senders

- `LoggingEmailSender` — default. Warns `email-verification: code sent email=… code=…` to the Cordis logger so dev / CI can read the code.
- `SmtpEmailSender` — talks to a real SMTP server via `nodemailer`. Loaded lazily; deployments without SMTP never pay the module-init cost.

## Storage

A separate SQLite file at `<path>/email-verification.sqlite` (default `<dshHome>/email-verification.sqlite`). The `email_verification_codes` table is keyed by normalized email, purpose, and invitation id. Attempts, locking, expiry, and deletion affect only that row, while the hourly send cap aggregates every active invitation for the same email. The plaintext code never touches disk — only the PBKDF2-HMAC-SHA256 hash.

## Wire codes

`packages/host/apiproxy/src/api/rpc.ts` adds:

- `email-invalid`
- `verification-code-required`
- `wrong-verification-code` (with `remainingAttempts`)
- `verification-code-expired`
- `verification-code-locked` (with `retryAfterSeconds`)
- `too-many-requests` (with `retryAfterSeconds`)

The SignInCard in `apps/desktop/src/renderer/features/auth/SignInCard.tsx` switches on these to paint the right inline message + countdown.

## Model Experience

None, as account verification completes before agent execution and registers no prompt, tool, or model-visible result.

#### KV Cache effect

None. Verification values never enter a model request.

## Known Limitations and Deferred Work

- **SMTP delivery is deployment-owned.** The logging sender exposes codes to development logs and must not be used as a production transport.
- **Codes are single-channel.** Password recovery and alternate verification channels remain outside this package.
