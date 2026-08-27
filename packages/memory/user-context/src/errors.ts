/**
 * Error vocabulary for the user-context seam. Mirrors the schema-validation +
 * seam-shape errors thrown by sibling packages (`@deepseek-ai/dsh-account-wallet`
 * uses the same `code: 'BAD_REQUEST' | ...` shape).
 *
 * Errors are `UserContextError` instances; consumers can switch on `code` to
 * drive the wire-layer mapping (`accountEmailCode`-style HTTP envelopes).
 */
import type { UserContextKind, UserContextKey } from './types.ts'

/** Error code vocabulary for the user-context seam. */
export type UserContextErrorCode =
  | 'BAD_REQUEST'
  | 'USER_CONTEXT_UNAVAILABLE'

/** Thrown by every public method when its input fails schema validation. */
export class UserContextError extends Error {
  /** Identifies errors raised by the user-context seam. */
  readonly kind = 'UserContext' as const
  constructor(
    readonly code: UserContextErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'UserContextError'
  }
}

/** Maximum bytes accepted in a single value; mirrors the on-disk column cap. */
export const MAX_VALUE_BYTES = 16 * 1024

/** Maximum key length (UTF-16 code units; checked at the boundary). */
export const MAX_KEY_LENGTH = 128

/** Maximum workspace id length (UTF-16 code units; checked at the boundary). */
export const MAX_WORKSPACE_ID_LENGTH = 128

/** Reserved kinds the store will accept. New kinds need an enum entry here. */
const VALID_KINDS: readonly UserContextKind[] = ['preference', 'working', 'profile']

/**
 * Validate a reserved user-context category.
 * @param value Candidate category.
 * @returns Narrows value to a valid category.
 */
export function assertKind(value: unknown): asserts value is UserContextKind {
  if (typeof value !== 'string' || !VALID_KINDS.includes(value as UserContextKind)) {
    throw new UserContextError('BAD_REQUEST', `kind must be one of ${VALID_KINDS.join(' | ')}`)
  }
}

/**
 * Validate a user-context key.
 * @param value Candidate key.
 * @returns Narrows value to a branded key.
 */
export function assertKey(value: unknown): asserts value is UserContextKey {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_KEY_LENGTH) {
    throw new UserContextError('BAD_REQUEST', `key must be a non-empty string up to ${MAX_KEY_LENGTH} chars`)
  }
}

/**
 * Validate an optional workspace scope.
 * @param value Candidate workspace id.
 * @returns Narrows value to a nullable string.
 */
export function assertWorkspaceId(value: unknown): asserts value is string | null {
  if (value === null || value === undefined) return
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_WORKSPACE_ID_LENGTH) {
    throw new UserContextError(
      'BAD_REQUEST',
      `workspaceId must be a non-empty string up to ${MAX_WORKSPACE_ID_LENGTH} chars when provided`,
    )
  }
}

/**
 * Validate and size-limit a stored value.
 * @param value Candidate value.
 * @returns Narrows value to a string.
 */
export function assertValue(value: unknown): asserts value is string {
  if (typeof value !== 'string') {
    throw new UserContextError('BAD_REQUEST', 'value must be a string')
  }
  // Use TextEncoder to count UTF-8 bytes; rejects oversized payloads early.
  const bytes = new TextEncoder().encode(value).byteLength
  if (bytes > MAX_VALUE_BYTES) {
    throw new UserContextError(
      'BAD_REQUEST',
      `value exceeds ${MAX_VALUE_BYTES} bytes (got ${bytes})`,
    )
  }
}
