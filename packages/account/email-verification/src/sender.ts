/**
 * Email senders. The seam is `EmailSender`; two implementations ship in this
 * package:
 *
 *  - `LoggingEmailSender` — always available; logs the code at WARN so the
 *    developer / CI can read it off stdout. Default fallback when SMTP is not
 *    configured.
 *
 *  - `SmtpEmailSender` — talks to a real SMTP server via `nodemailer`. Loaded
 *    lazily so a deployment without SMTP does not pay the module init cost.
 *
 * The seam is intentionally narrow (`sendVerificationCode` with a fixed body)
 * — wider templates are out of scope; the renderer paints its own UI surface.
 */

/** Structural logger contract — `ctx.logger` provides `info` / `warn`. */
export interface SenderLogger {
  info(format: string, ...args: unknown[]): void
  warn(format: string, ...args: unknown[]): void
}

/** Sends a verification message to an email address. */
export interface EmailSender {
  /**
   * Stable identifier for the sender kind. Used by `requestCode` to decide
   * whether to surface the freshly minted code on the wire response — only
   * non-delivering in-process senders (`'logging'`) echo the code back so
   * the renderer can paint it; SMTP-backed senders return a code that was
   * delivered out-of-band and must NOT be echoed on the wire.
   */
  readonly kind: 'logging' | 'smtp'
  /**
   * Deliver a verification code to the given email.
   * @throws on transport-level failure. The caller (requestCode) catches and
   *   surfaces `RESEND_COOLDOWN` or `RATE_LIMIT_EXCEEDED` to keep the wire
   *   error surface consistent.
   */
  sendVerificationCode(input: { to: string; code: string; expiresInSeconds: number }): Promise<void>
}

/** Default sender: warn-level log of the raw code so dev / CI can read it. */
export class LoggingEmailSender implements EmailSender {
  readonly kind = 'logging' as const

  constructor(private readonly logger: SenderLogger) {}

  sendVerificationCode(input: { to: string; code: string; expiresInSeconds: number }): Promise<void> {
    this.logger.warn(
      'email-verification: code sent email=%s code=%s expiresInSeconds=%d',
      input.to,
      input.code,
      input.expiresInSeconds,
    )
    return Promise.resolve()
  }
}

/** SMTP connection and sender settings for verification messages. */
export interface SmtpConfig {
  host: string
  port: number
  /**
   * `true` = implicit TLS / SMTPS (port 465, e.g. 163 / QQ / generic SMTPS).
   * `false` = STARTTLS upgrade after the connect (port 587 / 25, e.g. SendGrid
   * / Gmail submission), or plain text when `useTls` is also `false`.
   */
  useSsl: boolean
  /**
   * `true` = STARTTLS upgrade after the connect (only meaningful when
   * `useSsl === false`). Ignored when `useSsl === true`.
   */
  useTls: boolean
  username: string
  password: string
  fromAddress: string
  timeoutSeconds: number
}

/**
 * SMTP-backed sender. Constructed lazily — when the operator does not provide
 * SMTP env, the package never reaches `import('nodemailer')`.
 *
 * Transport semantics mirror my-agents' `SmtpEmailSender`:
 *   - `useSsl=true` → implicit TLS from connect (port 465). STARTTLS is
 *     skipped — `useSsl` wins over `useTls` per the my-agents convention.
 *   - `useSsl=false`, `useTls=true` → STARTTLS upgrade after connect
 *     (port 587 / 25, e.g. SendGrid / Gmail submission).
 *   - `useSsl=false`, `useTls=false` → plain text. Only appropriate for
 *     local debugging relays; reject upstream unless the operator opts in.
 */
export class SmtpEmailSender implements EmailSender {
  readonly kind = 'smtp' as const

  constructor(
    private readonly config: SmtpConfig,
    private readonly logger: SenderLogger,
  ) {}

  async sendVerificationCode(input: { to: string; code: string; expiresInSeconds: number }): Promise<void> {
    // Dynamic import keeps the package start-up cost independent of SMTP use.
    // Nodemailer ships as CJS (`module.exports.createTransport = ...`); under
    // Node's ESM interop, the default export is the module namespace object
    // carrying `createTransport`. The lookup tolerates both shapes so this
    // works regardless of how the host packages the module.
    const nodemailerModule = (await import('nodemailer')) as unknown as {
      default?: { createTransport?: (...args: unknown[]) => unknown }
      createTransport?: (...args: unknown[]) => unknown
    }
    const createTransport =
      nodemailerModule.default?.createTransport
      ?? nodemailerModule.createTransport
      ?? (nodemailerModule.default as unknown as (...args: unknown[]) => unknown)
    if (typeof createTransport !== 'function') {
      throw new Error('email-verification: nodemailer import did not expose createTransport')
    }
    // Nodemailer maps `secure: true` to SMTPS (port 465, implicit TLS).
    // For STARTTLS on port 587 we want `secure: false` + `requireTLS: true`.
    // When both `useSsl` and `useTls` are false we omit `requireTLS` so
    // nodemailer speaks plain text (the operator's debug relay).
    const secure = this.config.useSsl
    const requireTls = !this.config.useSsl && this.config.useTls
    const transporter = (createTransport as (options: Record<string, unknown>) => {
      sendMail: (mail: Record<string, unknown>) => Promise<unknown>
    })({
      host: this.config.host,
      port: this.config.port,
      secure,
      // `ignoreTLS: true` suppresses nodemailer's opportunistic STARTTLS
      // upgrade when `requireTls` is also false. Without it, nodemailer
      // would silently upgrade plain-text sessions on servers that
      // advertise STARTTLS, contradicting the operator's explicit choice.
      ...(requireTls ? { requireTLS: true } : { ignoreTLS: true }),
      auth: this.config.username.length > 0
        ? { user: this.config.username, pass: this.config.password }
        : undefined,
      connectionTimeout: this.config.timeoutSeconds * 1000,
    })
    const minutes = Math.max(1, Math.round(input.expiresInSeconds / 60))
    const subject = '【小薇】您的注册验证码'
    const text = [
      '您好，',
      '',
      `您的 小薇 注册验证码为：${input.code}`,
      '',
      `验证码 ${minutes} 分钟内有效，请尽快在注册页面填入。`,
      '',
      '— 小薇团队',
    ].join('\n')
    const html = [
      '<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#0e1118;color:#e9ecf3;border-radius:12px;">',
      '  <h2 style="margin:0 0 16px;color:#70ddd2;">小薇</h2>',
      '  <p>您好，</p>',
      '  <p>您的注册验证码为：</p>',
      `  <p style="font-family:SF Mono,Menlo,monospace;font-size:32px;letter-spacing:0.2em;color:#37b9ad;margin:24px 0;text-align:center;">${input.code}</p>`,
      `  <p style="color:#a6aebc;">验证码 ${minutes} 分钟内有效，请尽快在注册页面填入。</p>`,
      '  <hr style="border:none;border-top:1px solid #232a39;margin:24px 0;">',
      '  <p style="color:#6d7688;font-size:12px;">如果您没有请求此验证码，请忽略此邮件。</p>',
      '</div>',
    ].join('\n')
    await transporter.sendMail({
      from: this.config.fromAddress,
      to: input.to,
      subject,
      text,
      html,
    })
    this.logger.info('email-verification: code sent via smtp email=%s host=%s:%d', input.to, this.config.host, this.config.port)
  }
}
