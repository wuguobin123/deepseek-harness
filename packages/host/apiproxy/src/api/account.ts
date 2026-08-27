/**
 * account domain contract — wire projection of `ctx.identity` for the
 * multi-user xiaowei backend. Signup, email-code, and signin are public after
 * the Host/trusted-authority check, but signup requires a live invitation.
 * Invitation creation and listing require an account bearer and derive their
 * owner from that authenticated principal. Signin carries a freshly issued
 * bearer token the fence reads on every subsequent account request.
 *
 * Branded ids (`UserId`, `SessionToken`) ride the wire as strings carrying the
 * same opaque brand strings the host seam uses — the api/ layer is browser
 * safe and cannot import the identity package, so the brand cast lives in
 * the handler's identity call site instead.
 */

import type { RpcRequest, RpcResponse } from './rpc.ts'

/** Wire-side opaque user id brand. Mirrors `UserId` from dsh-account-identity. */
export type UserId = string
/** Wire-side opaque session token brand. Mirrors `SessionToken` from dsh-account-identity. */
export type SessionToken = string

/** One session's wire view: id, display name, bearer token, absolute expiry. */
export interface SignedIn {
  userId: UserId
  displayName: string | null
  sessionToken: SessionToken
  /** Absolute unix-millisecond expiry of the freshly-issued session. */
  expiresAt: number
}

/** Cold-start probe of an existing token's live account view. */
export interface AuthenticatedView {
  userId: UserId
  displayName: string | null
  /** Absolute unix-millisecond expiry of the session this view came from. */
  expiresAt: number
}

/** Metadata for an account-owned invitation; active unconsumed rows include
 * plaintext, while used, expired, or legacy rows carry `code: null`. */
export interface InvitationView {
  invitationId: string
  codeMask: string
  code: string | null
  createdAt: number
  expiresAt: number
  consumedAt: number | null
  redeemedBy: string | null
}

/** account-domain unary methods (the map keys account.* of RpcMethodMap). */
export interface AccountApi {
  /**
   * Create one account and return an immediately-valid session.
   * @throws `bad-request` on schema-rejected input (the seam's own message).
   * @throws `email-taken` when the email is already registered.
   * @throws `invitation-invalid` when the invitation is unusable.
   * @throws `user-limit` when the validation cohort is full.
   */
  signup(request: RpcRequest<{
    email: string
    password: string
    displayName?: string
    /**
     * Six-digit verification code from a prior `account.emailCode` call.
     * Required when the host's email-verification seam is enabled; the host
     * surfaces `verification-code-required` when omitted and the seam is on.
     */
    verificationCode?: string
    invitationCode: string
  }>): Promise<RpcResponse<SignedIn>>

  /**
   * Mint a fresh 6-digit verification code and dispatch it to the given email.
   * Public (non-privileged): anonymous LAN callers may pre-flight signup by
   * sending themselves a code. Rate-limited at the seam — the host returns
   * `email-code-resend-cooldown` or `email-code-rate-limit` when throttled.
   * @throws `invitation-invalid` when the invitation is unusable.
   */
  emailCode(request: RpcRequest<{ email: string; invitationCode: string }> ): Promise<RpcResponse<{
    expiresInSeconds: number
    retryAfterSeconds: number
  }>>

  /** Account-owned invitation methods. */
  invites: {
    /** Create one single-use invitation and return its plaintext.
     * @throws `invitation-limit` after the account's third lifetime issue.
     * @throws `user-limit` when the validation cohort is full.
     */
    create(request: RpcRequest<Record<string, never>>): Promise<RpcResponse<InvitationView & { code: string }>>
    /** List the authenticated account's invitations; only active unconsumed
     * decryptable rows include plaintext, terminal and legacy rows are null. */
    list(request: RpcRequest<Record<string, never>>): Promise<RpcResponse<{ items: InvitationView[] }>>
    /** Regenerate an active invitation without consuming a new lifetime slot. */
    rotate(request: RpcRequest<{ invitationId: string }>): Promise<RpcResponse<InvitationView & { code: string }>>
  }

  /**
   * Verify an email + password pair and issue a fresh session token.
   * Constant-time failure: a wrong password and a missing account return the
   * same wire code (`unauthenticated`) and the same message — distinguishing
   * the two leaks an email-oracle.
   * @throws `unauthenticated` on either wrong password or missing account.
   */
  signin(request: RpcRequest<{
    email: string
    password: string
  }>): Promise<RpcResponse<SignedIn>>

  /**
   * Revoke one bearer token. Idempotent: an unknown token resolves with
   * `{ revoked: true }` rather than throwing.
   */
  signout(request: RpcRequest<{
    sessionToken: SessionToken
  }>): Promise<RpcResponse<{ revoked: true }>>

  /**
   * Resolve a bearer token to its live account view (desktop cold-start probe).
   * Unknown / expired / revoked tokens resolve to `null` rather than throwing —
   * this is the "do I have a valid session?" question and the answer drives
   * whether the cold-start card shows signin vs. account.
   */
  state(request: RpcRequest<{
    sessionToken: SessionToken
  }>): Promise<RpcResponse<AuthenticatedView | null>>
}
