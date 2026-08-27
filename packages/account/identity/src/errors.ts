/**
 * Identity-specific error codes. The wire layer (`packages/host/apiproxy/src/api/account.ts`)
 * maps these to RPC error codes so the renderer / desktop can branch without
 * reading the message string.
 *
 * `UNAUTHENTICATED` is intentionally non-specific: signin must not reveal
 * whether the email exists — the same code covers wrong-password and
 * no-such-account. A future PR with telemetry can split internal-vs-exposed
 * codes; the wire surface stays one.
 */

/** Re-export the brand types so a single import carries everything. */
export type { AuthenticatedView, SignedIn, UserId, SessionToken } from './types.ts'

/** Wire-level error codes returned by `account.*` methods. */
export type IdentityErrorCode =
  | 'UNAUTHENTICATED'
  | 'BAD_REQUEST'
  | 'EMAIL_TAKEN'
  | 'SESSION_EXPIRED'
  | 'IDENTITY_UNAVAILABLE'
  | 'INVITATION_REQUIRED'
  | 'INVITATION_INVALID'
  | 'INVITATION_LIMIT'
  | 'USER_LIMIT'

/** Thrown by the local provider; carries a stable wire code + message. */
export class IdentityError extends Error {
  /** Machine-readable error code for wire-layer mapping. */
  readonly code: IdentityErrorCode
  override readonly cause?: unknown

  constructor(code: IdentityErrorCode, message: string, cause?: unknown) {
    super(message)
    this.name = 'IdentityError'
    this.code = code
    if (cause !== undefined) this.cause = cause
  }
}

/** Maximum length of an accepted email address; aligned with RFC 5321 §4.5.3.1. */
export const MAX_EMAIL_LENGTH = 254
/** Maximum length of an accepted password; longer passwords raise DoS risk. */
export const MAX_PASSWORD_LENGTH = 1024

/**
 * Validate an email string. Empty strings are rejected; otherwise we accept
 * anything containing a single `@` with non-empty local and domain halves —
 * a stronger regex (RFC 5322) is overkill for an account-bound identifier.
 * @param email Email value to validate.
 * @returns Nothing; throws {@link IdentityError} when invalid.
 */
export function assertEmail(email: string): void {
  if (typeof email !== 'string') throw new IdentityError('BAD_REQUEST', 'email must be a string')
  if (email.length === 0 || email.length > MAX_EMAIL_LENGTH) {
    throw new IdentityError('BAD_REQUEST', 'email length must be 1..254')
  }
  const at = email.indexOf('@')
  if (at <= 0 || at !== email.lastIndexOf('@') || at === email.length - 1) {
    throw new IdentityError('BAD_REQUEST', 'email must contain exactly one "@" with non-empty halves')
  }
}

/**
 * Validate a password string. Empty strings are rejected (no anonymous
 * accounts); long-but-legitimate passwords above {@link MAX_PASSWORD_LENGTH}
 * are also rejected to bound scrypt cost.
 * @param password Password value to validate.
 * @returns Nothing; throws {@link IdentityError} when invalid.
 */
export function assertPassword(password: string): void {
  if (typeof password !== 'string') throw new IdentityError('BAD_REQUEST', 'password must be a string')
  if (password.length === 0) throw new IdentityError('BAD_REQUEST', 'password must not be empty')
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new IdentityError('BAD_REQUEST', `password length must be ≤ ${MAX_PASSWORD_LENGTH}`)
  }
}
