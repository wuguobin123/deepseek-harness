/**
 * Service Definition + default SQLite-backed provider for the email verification
 * code seam. Mirrors `packages/account/identity/`:
 *
 *   - The abstract `EmailVerificationService` lives here.
 *   - The sole implementation `LocalEmailVerificationProvider` lives here too
 *     (pre-release stance: skip the abstract-only package layer).
 *   - The provider owns one SQLite file `<dshHome>/email-verification.sqlite`
 *     with one table `email_verification_codes`; its key is normalized email,
 *     verification purpose, and invitation id.
 *
 * Wire methods in `packages/host/apiproxy/src/api/account.ts` add
 * `account.emailCode` (public, non-privileged) that proxies to
 * `ctx.emailVerification.requestCode(...)`. The signup handler in the same file
 * calls `ctx.emailVerification.verifyCode(...)` to gate the new account when
 * `config.enabled === true`.
 *
 * Tunables (config-driven, fail-loud if misconfigured):
 *   - enabled: false shuts the whole seam off; `verifyCode` becomes a no-op
 *     pass-through so the existing signup path keeps working in dev.
 *   - ttlSeconds: 600 (10 min).
 *   - resendCooldownSeconds: 60.
 *   - maxSendsPerHour: 10.
 *   - maxAttemptsBeforeLock: 5.
 *   - lockoutSeconds: 1800 (30 min).
 *
 * @module @deepseek-ai/dsh-account-email-verification
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { EmailVerificationError } from './errors.ts'
import {
  assertCode,
  assertEmail,
  codesEqual,
  hashCode,
  mintCode,
  mintSalt,
  nowMillis,
} from './code.ts'
import { EmailVerificationStore, openVerificationDatabase } from './store.ts'
import { LoggingEmailSender, SmtpEmailSender, type EmailSender, type SenderLogger } from './sender.ts'
import type { EmailCodeRequestResult } from './types.ts'

/** Plugin configuration. */
export interface Config {
  /** Path to the SQLite database file (`:memory:` for tests). */
  path: string
  /** Master kill switch — `false` short-circuits `requestCode` and `verifyCode`. */
  enabled?: boolean
  /** Code lifetime in seconds. */
  ttlSeconds?: number
  /** Minimum seconds between two sends to the same email. */
  resendCooldownSeconds?: number
  /** Maximum number of sends per email within a rolling 1-hour window. */
  maxSendsPerHour?: number
  /** Wrong-code attempts before the email is locked. */
  maxAttemptsBeforeLock?: number
  /** Lockout duration after the attempts threshold is exceeded. */
  lockoutSeconds?: number
  /** Which sender to construct. 'logging' = stdout WARN; 'smtp' = nodemailer. */
  transportKind?: 'logging' | 'smtp'
  /** SMTP host. Required when transportKind === 'smtp'. */
  smtpHost?: string
  /**
   * SMTP port. Default 587 (submission, STARTTLS) — matches the my-agents
   * convention. Common alternatives: 465 (implicit SMTLS), 25 (plain /
   * STARTTLS relay), 2525 (cloud submission alternative).
   */
  smtpPort?: number
  /**
   * `true` = implicit TLS (port 465, e.g. 163 / QQ / generic SMTPS).
   * When `true`, STARTTLS is skipped — `use_ssl` wins over `use_tls` per
   * the my-agents semantics. Default `false` because the default port
   * is STARTTLS-based (587).
   */
  smtpUseSsl?: boolean
  /**
   * `true` = STARTTLS upgrade after connect (port 587 / 25, e.g. SendGrid /
   * Gmail submission). Default `true` to match the my-agents default.
   * Ignored when `smtpUseSsl` is `true`.
   */
  smtpUseTls?: boolean
  /** SMTP auth username. Optional for unauthenticated relays. */
  smtpUsername?: string
  /** SMTP auth password. */
  smtpPassword?: string
  /** From-address on outgoing mails. Required when transportKind === 'smtp'. */
  smtpFromAddress?: string
  /** SMTP connection timeout in seconds. */
  smtpTimeoutSeconds?: number
}

export const Config: z<Config> = z.object({
  path: z.string().required(),
  enabled: z.boolean().default(true),
  ttlSeconds: z.number().step(1).min(30).max(3600).default(600),
  resendCooldownSeconds: z.number().step(1).min(0).max(600).default(60),
  maxSendsPerHour: z.number().step(1).min(1).max(1000).default(10),
  maxAttemptsBeforeLock: z.number().step(1).min(1).max(50).default(5),
  lockoutSeconds: z.number().step(1).min(60).max(86_400).default(1800),
  // Transport selection: `kind` is one of 'logging' | 'smtp'. The other
  // fields are only meaningful for 'smtp'; the sender builder below selects
  // between the two impls by inspecting `kind`. Schemastery does not expose
  // `z.literal`, so the union uses the inline string-array form.
  transportKind: z.union(['logging', 'smtp']).default('logging'),
  smtpHost: z.string().default(''),
  smtpPort: z.number().step(1).min(1).max(65_535).default(587),
  smtpUseSsl: z.boolean().default(false),
  smtpUseTls: z.boolean().default(true),
  smtpUsername: z.string().default(''),
  smtpPassword: z.string().default(''),
  smtpFromAddress: z.string().default(''),
  smtpTimeoutSeconds: z.number().step(1).min(1).max(120).default(10),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The local email-verification provider. */
    emailVerification: EmailVerificationService
  }
}

/**
 * The Service Definition. Wire methods project its two public methods.
 *
 * Implementations MUST be safe to call concurrently from the same Cordis
 * context — the host-side RPC handlers do not serialize requests.
 */
export abstract class EmailVerificationService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'emailVerification')
  }

  /**
   * Whether the seam is wired. `false` means `verifyCode` becomes a no-op.
   * @returns `true` when verification gates `signup`; `false` when the seam
   *   is disabled and `verifyCode` is a pass-through.
   */
  abstract isEnabled(): boolean

  /**
   * Mint and dispatch a fresh 6-digit code to the given email.
   * @param input.email The email address the code is dispatched to.
   * @returns The TTL and resend cooldown the renderer should advertise.
   * @throws EmailVerificationError on bad input, cooldown, rate-limit, lockout,
   *   or transport failure. The host layer maps these to wire codes.
   */
  abstract requestCode(input: { email: string; purpose?: string; invitationId?: string }): Promise<EmailCodeRequestResult>

  /**
   * Verify a code against the row that `requestCode` produced.
   * @param input.email The email address the code was sent to.
   * @param input.code The 6-digit candidate code the caller is asserting.
   * @returns `true` when the code matches and the row is within TTL and not
   *   locked. The verified row is deleted so the same code cannot be reused.
   * @throws EmailVerificationError on bad input, missing row, wrong code,
   *   expired code, or lockout. Errors that increment the attempts counter
   *   are reflected in the row before the throw.
   */
  abstract verifyCode(input: { email: string; code: string; purpose?: string; invitationId?: string }): Promise<boolean>
}

/**
 * SQLite-backed local provider. Singleton per Cordis context.
 *
 * Lifecycle:
 *   - Constructor stores config; opens the SQLite handle on first use.
 *   - `[Service.init]` opens the database, applies DDL, prunes expired rows.
 *   - Disposal closes the underlying handle.
 */
export class LocalEmailVerificationProvider extends EmailVerificationService {
  static Config = Config

  private storeReady: Promise<EmailVerificationStore> | undefined
  private sender: EmailSender
  private closed = false

  constructor(ctx: Context, public config: Config) {
    super(ctx)
    // Cordis logger carries the methods `info` / `warn` plus a few host-only
    // hooks; the SenderLogger structural view keeps this seam independent.
    this.sender = buildSender(config, ctx.logger)
  }

  override isEnabled(): boolean {
    return this.config.enabled !== false
  }

  async *[Service.init](): AsyncGenerator<() => Promise<void> | void, void, void> {
    const store = await this.openStore()
    const purged = store.purgeExpired(nowMillis())
    if (purged > 0) {
      this.ctx.logger.info('email-verification: purged %d expired rows', purged)
    }
    yield () => {
      this.closed = true
      store.close()
    }
  }

  private openStore(): Promise<EmailVerificationStore> {
    if (this.storeReady !== undefined) return this.storeReady
    this.storeReady = (async () => {
      const db = await openVerificationDatabase(this.config.path)
      return new EmailVerificationStore(db)
    })()
    this.storeReady.catch(() => undefined)
    return this.storeReady
  }

  override async requestCode(input: { email: string; purpose?: string; invitationId?: string }): Promise<EmailCodeRequestResult> {
    const email = input.email.trim().toLowerCase()
    assertEmail(email)
    if (!this.isEnabled()) {
      throw new EmailVerificationError('EMAIL_VERIFICATION_DISABLED', 'email verification is disabled')
    }
    const store = await this.openStore()
    this.assertOpen(store)
    const now = nowMillis()

    const purpose = input.purpose ?? 'signup'
    const invitationId = input.invitationId ?? ''
    const existing = store.findByEmail(email, purpose, invitationId)
    const aggregate = store.sendAggregate(email, now)
    if (aggregate.sendCount >= (this.config.maxSendsPerHour ?? 10)) {
      const retryAfter = Math.max(1, Math.ceil((3_600_000 - (now - aggregate.windowStartedAt)) / 1000))
      throw new EmailVerificationError('RATE_LIMIT_EXCEEDED', 'too many verification-code requests; try again later', retryAfter)
    }
    if (existing !== undefined) {
      // Lockout precedes everything else: once locked, even the cooldown check
      // is moot — we refuse until the lockout window closes.
      if (existing.locked_until !== null && existing.locked_until > now) {
        const retryAfter = Math.max(1, Math.ceil((existing.locked_until - now) / 1000))
        throw new EmailVerificationError(
          'CODE_LOCKED',
          'verification code attempts locked; try again later',
          retryAfter,
        )
      }
      // Rolling per-hour cap.
      const hourWindowAgeMs = now - aggregate.windowStartedAt
      if (hourWindowAgeMs < 3_600_000 && aggregate.sendCount >= (this.config.maxSendsPerHour ?? 10)) {
        const retryAfter = Math.max(1, Math.ceil((3_600_000 - hourWindowAgeMs) / 1000))
        throw new EmailVerificationError(
          'RATE_LIMIT_EXCEEDED',
          'too many verification-code requests; try again later',
          retryAfter,
        )
      }
      // Resend cooldown.
      const cooldownMs = (this.config.resendCooldownSeconds ?? 60) * 1000
      if (now - existing.last_sent_at < cooldownMs) {
        const retryAfter = Math.max(1, Math.ceil((cooldownMs - (now - existing.last_sent_at)) / 1000))
        throw new EmailVerificationError(
          'RESEND_COOLDOWN',
          'please wait before requesting another code',
          retryAfter,
        )
      }
    }

    const code = mintCode()
    const salt = mintSalt()
    const codeHash = hashCode(code, salt)
    const ttlSeconds = this.config.ttlSeconds ?? 600
    const resendCooldownSeconds = this.config.resendCooldownSeconds ?? 60
    const expiresAt = now + ttlSeconds * 1000
    const sendCount = (existing !== undefined && now - existing.hour_window_started_at < 3_600_000)
      ? existing.send_count + 1
      : 1
    const hourWindowStartedAt = (existing !== undefined && now - existing.hour_window_started_at < 3_600_000)
      ? existing.hour_window_started_at
      : now

    store.upsert({
      email,
      purpose,
      invitationId,
      salt,
      codeHash,
      expiresAt,
      lastSentAt: now,
      sendCount,
      hourWindowStartedAt,
      createdAt: existing?.created_at ?? now,
    })

    try {
      await this.sender.sendVerificationCode({
        to: email,
        code,
        expiresInSeconds: ttlSeconds,
      })
    } catch (error) {
      // Roll back the row so the user can retry without waiting for the cooldown.
      store.delete(email, purpose, invitationId)
      throw error
    }

    // Only echo the raw code back when the active sender is the in-process
    // logging transport. Real SMTP transports deliver the code to the
    // mailbox out-of-band — surfacing the raw code on the wire would let
    // any LAN caller learn it from `account.emailCode`, defeating the
    // whole point of email ownership. The seam is keyed off the sender's
    // stable `kind` rather than the config string so the policy stays
    // correct under future sender implementations.
    const devCode = this.sender.kind === 'logging' ? code : undefined

    return {
      expiresInSeconds: ttlSeconds,
      retryAfterSeconds: resendCooldownSeconds,
      ...(devCode !== undefined ? { devCode } : {}),
    }
  }

  override async verifyCode(input: { email: string; code: string; purpose?: string; invitationId?: string }): Promise<boolean> {
    const email = input.email.trim().toLowerCase()
    assertEmail(email)
    assertCode(input.code)
    if (!this.isEnabled()) {
      // Disabled seams pass through; the host can still gate signup through
      // other means (e.g. the bootstrap admin).
      return true
    }
    const store = await this.openStore()
    this.assertOpen(store)
    const now = nowMillis()

    const purpose = input.purpose ?? 'signup'
    const invitationId = input.invitationId ?? ''
    const row = store.findByEmail(email, purpose, invitationId)
    if (row === undefined) {
      throw new EmailVerificationError('CODE_NOT_FOUND', 'no verification code requested for this email')
    }
    if (row.locked_until !== null && row.locked_until > now) {
      const retryAfter = Math.max(1, Math.ceil((row.locked_until - now) / 1000))
      throw new EmailVerificationError('CODE_LOCKED', 'verification code attempts locked', retryAfter)
    }
    if (row.expires_at <= now) {
      store.delete(email, purpose, invitationId)
      throw new EmailVerificationError('CODE_EXPIRED', 'verification code has expired')
    }

    const candidate = hashCode(input.code, row.salt)
    if (!codesEqual(candidate, row.code_hash)) {
      store.incrementAttempts(email, purpose, invitationId)
      const newAttempts = row.attempts + 1
      const maxAttemptsBeforeLock = this.config.maxAttemptsBeforeLock ?? 5
      const lockoutSeconds = this.config.lockoutSeconds ?? 1800
      if (newAttempts >= maxAttemptsBeforeLock) {
        const lockedUntil = now + lockoutSeconds * 1000
        store.lock(email, lockedUntil, purpose, invitationId)
        const retryAfter = Math.max(1, Math.ceil((lockedUntil - now) / 1000))
        throw new EmailVerificationError(
          'CODE_LOCKED',
          `too many wrong attempts; locked for ${lockoutSeconds}s`,
          retryAfter,
        )
      }
      throw new EmailVerificationError(
        'WRONG_CODE',
        `incorrect verification code (${maxAttemptsBeforeLock - newAttempts} attempts remaining)`,
      )
    }

    // Success: delete the row so the same code cannot be reused.
    store.delete(email, purpose, invitationId)
    return true
  }

  private assertOpen(store: EmailVerificationStore): void {
    if (this.closed || store.isClosed()) {
      throw new EmailVerificationError('EMAIL_VERIFICATION_DISABLED', 'email verification provider has been disposed')
    }
  }
}

/** Build the sender from config. SMTP uses lazy nodemailer import. */
function buildSender(config: Config, logger: SenderLogger): EmailSender {
  const kind = config.transportKind ?? 'logging'
  if (kind === 'logging') {
    return new LoggingEmailSender(logger)
  }
  if (config.smtpHost === undefined || config.smtpHost.length === 0 || config.smtpFromAddress === undefined) {
    throw new Error('email-verification: transportKind=smtp requires smtpHost and smtpFromAddress')
  }
  return new SmtpEmailSender({
    host: config.smtpHost,
    port: config.smtpPort ?? 587,
    useSsl: config.smtpUseSsl ?? false,
    useTls: config.smtpUseTls ?? true,
    username: config.smtpUsername ?? '',
    password: config.smtpPassword ?? '',
    fromAddress: config.smtpFromAddress,
    timeoutSeconds: config.smtpTimeoutSeconds ?? 10,
  }, logger)
}

export default LocalEmailVerificationProvider

export type { EmailCodeRequestResult } from './types.ts'
export { EmailVerificationError, type EmailVerificationErrorCode } from './errors.ts'
export { CODE_REGEX } from './code.ts'
export { LoggingEmailSender, SmtpEmailSender, type EmailSender, type SmtpConfig } from './sender.ts'
export { SCHEMA_VERSION as EMAIL_VERIFICATION_SQLITE_SCHEMA_VERSION, APPLICATION_ID as EMAIL_VERIFICATION_SQLITE_APPLICATION_ID } from './store.ts'
