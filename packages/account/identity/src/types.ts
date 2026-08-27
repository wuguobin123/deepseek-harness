/**
 * Cross-boundary id brands for the identity seam.
 *
 * Branding makes `UserId` and `SessionToken` non-interchangeable with bare
 * strings at the type level — same primitive at runtime, distinct identity at
 * the type-check layer. Construction goes through the factory functions in
 * `store.ts` (private cast); comparison and serialization behave as ordinary
 * strings.
 *
 * @module @deepseek-ai/dsh-account-identity/types
 */
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Opaque, locally-minted account id (16 random bytes, urlsafe base64). */
export type UserId = Branded<'UserId'>

/** Opaque session token (32 random bytes, urlsafe base64) issued at signin. */
export type SessionToken = Branded<'SessionToken'>
/** Opaque identifier for one invitation record. */
export type InvitationId = Branded<'InvitationId'>

/** Metadata returned when an invitation is inspected or listed. */
export interface InvitationView {
  readonly invitationId: InvitationId
  readonly codeMask: string
  /** Plaintext code for active, unconsumed, unexpired invitations; otherwise null. */
  readonly code: string | null
  readonly createdAt: number
  readonly expiresAt: number
  readonly consumedAt: number | null
  readonly redeemedBy: UserId | null
}

/** The result of a successful signin. */
export interface SignedIn {
  readonly userId: UserId
  readonly email: string
  readonly displayName: string | null
  /** The opaque token to put on the `Authorization: Bearer` header. */
  readonly sessionToken: SessionToken
  /** Unix milliseconds when this token expires; clients refetch before then. */
  readonly expiresAt: number
}

/** A validated-but-not-signed-in probe (used by `account.state`). */
export interface AuthenticatedView {
  readonly userId: UserId
  readonly email: string
  readonly displayName: string | null
  /** Unix milliseconds when the current session token expires. */
  readonly expiresAt: number
}
