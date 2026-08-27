/**
 * Public types for the email verification seam.
 *
 * The wire shape (request and value) lives here so the host API proxy can
 * build its zod schemas without depending on the package internals.
 */

/** The value returned by `requestCode` so the UI can paint a countdown. */
export interface EmailCodeRequestResult {
  /** Seconds until a freshly-issued code expires. */
  readonly expiresInSeconds: number
  /** Seconds the caller must wait before another send will be accepted. */
  readonly retryAfterSeconds: number
  /**
   * The freshly minted code, surfaced only when the active transport is the
   * in-process `LoggingEmailSender` (i.e. SMTP is not configured). Production
   * SMTP deploys do NOT populate this field — the code is delivered to the
   * user's mailbox by the SMTP transport, not echoed back over the wire.
   *
   * Surface contract: this is the authoritative place where the renderer
   * learns that the seam is running in dev mode (no real mail delivery).
   * A non-null value also serves as the user's only way to read the code
   * in environments without an SMTP relay.
   */
  readonly devCode?: string
}

/** A row from the `email_verification_codes` table. */
export interface EmailVerificationRow {
  readonly email: string
  readonly purpose: string
  readonly invitation_id: string
  readonly salt: Buffer
  readonly code_hash: Buffer
  readonly expires_at: number
  readonly attempts: number
  readonly locked_until: number | null
  readonly last_sent_at: number
  readonly send_count: number
  readonly hour_window_started_at: number
  readonly created_at: number
}
