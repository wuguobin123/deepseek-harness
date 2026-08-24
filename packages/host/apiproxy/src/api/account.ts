/**
 * account domain contract — wire projection of `ctx.identity` for the
 * multi-user workbuddy backend. The four methods are deliberately NOT in
 * PRIVILEGED_METHODS (see dsh-client-connection): anonymous LAN callers may
 * hit signup and signin so the deployment can grow users from cold start,
 * and signin carries a freshly-issued bearer token the fence reads on every
 * subsequent privileged request. signout and state are the two wire surfaces
 * a signed-in client touches; both require a valid bearer in the header, but
 * neither mutates the deployment configuration.
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

/** account-domain unary methods (the map keys account.* of RpcMethodMap). */
export interface AccountApi {
  /**
   * Create one account and return an immediately-valid session.
   * @throws `bad-request` on schema-rejected input (the seam's own message).
   * @throws `email-taken` when the email is already registered.
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
  }>): Promise<RpcResponse<SignedIn>>

  /**
   * Mint a fresh 6-digit verification code and dispatch it to the given email.
   * Public (non-privileged): anonymous LAN callers may pre-flight signup by
   * sending themselves a code. Rate-limited at the seam — the host returns
   * `too-many-requests` when the cooldown or per-hour cap is hit.
   */
  emailCode(request: RpcRequest<{ email: string }>): Promise<RpcResponse<{
    expiresInSeconds: number
    retryAfterSeconds: number
  }>>

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
