/**
 * Email-verification error codes. The wire layer maps these to RPC codes:
 *   - `RESEND_COOLDOWN` / `RATE_LIMIT_EXCEEDED` -> 429 (caller retries)
 *   - everything else -> 400 (caller fixes input)
 *
 * The codes are intentionally stable — the UI in `apps/desktop/src/renderer/
 * features/auth/SignInCard.tsx` branches on them in human-readable form.
 */

export type EmailVerificationErrorCode =
  | 'EMAIL_INVALID'
  | 'VERIFICATION_CODE_REQUIRED'
  | 'CODE_NOT_FOUND'
  | 'WRONG_CODE'
  | 'CODE_EXPIRED'
  | 'CODE_LOCKED'
  | 'RESEND_COOLDOWN'
  | 'RATE_LIMIT_EXCEEDED'
  | 'EMAIL_VERIFICATION_DISABLED'

/** Stable error raised by email-verification operations. */
export class EmailVerificationError extends Error {
  /** Machine-readable error code for wire-layer mapping. */
  readonly code: EmailVerificationErrorCode
  /** Optional retry hint surfaced to the client. */
  readonly retryAfterSeconds: number | undefined

  constructor(code: EmailVerificationErrorCode, message: string, retryAfterSeconds?: number) {
    super(message)
    this.name = 'EmailVerificationError'
    this.code = code
    if (retryAfterSeconds !== undefined) this.retryAfterSeconds = retryAfterSeconds
  }
}
