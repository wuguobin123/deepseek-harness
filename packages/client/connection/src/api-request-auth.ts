/**
 * Bearer-auth gate for privileged `/api` methods.
 *
 * The browser-trust fence ([api-request-trust](./api-request-trust.ts)) binds
 * the request to a same-origin Host and refuses cross-site markers; it is not
 * an authentication layer. This module supplies the identity half after that
 * transport fence has passed: a valid Bearer token resolves to an account
 * user id for downstream RPCs.
 *
 * Loopback callers may receive a local principal only when the transport
 * fence accepts the request. Bearer authentication never bypasses that fence.
 *
 * The dependency on the identity package is intentionally structural: the
 * fence must compile and run when `identity` is absent (bundles that do not
 * mount auth, snapshot tests, and `verify-cordis-config` gates). `ctx.get` on
 * a missing service returns undefined; the gate then falls through to the
 * existing trust fence.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { RpcPrincipal } from '@deepseek-ai/dsh-host-apiproxy/api'

/** Structural header map — covers Node's `IncomingHttpHeaders` and the WHATWG
 *  `Headers` interface without pulling `node:http` into the client plane. */
export type BearerHeaders = Record<string, string | string[] | undefined> | Headers

/** The fact the gate reads from a request. */
export interface AuthenticatedApiRequest {
  headers: BearerHeaders
}

/**
 * Structural identity contract the gate depends on. The real
 * `IdentityService` from `@deepseek-ai/dsh-account-identity` matches; the
 * structural type keeps this package free of that peer dep so the fence
 * compiles and loads without it.
 */
export interface BearerValidatingService {
  validate(input: { sessionToken: string }): Promise<{ userId: string; displayName: string | null } | null>
}

/**
 * Pull the bearer token out of an `Authorization: Bearer <token>` header.
 * Returns undefined when the header is missing, malformed, or uses a different
 * scheme. Whitespace is trimmed; an empty token is undefined.
 * @param headers - Node or Fetch request headers.
 * @returns The trimmed bearer token, or undefined when no valid bearer syntax exists.
 */
export function extractBearerToken(headers: BearerHeaders): string | undefined {
  const raw = header(headers, 'authorization')
  if (raw === undefined) return undefined
  const trimmed = raw.trim()
  if (trimmed.length < 7) return undefined
  const prefix = trimmed.slice(0, 7).toLowerCase()
  if (prefix !== 'bearer ') return undefined
  const token = trimmed.slice(7).trim()
  return token.length > 0 ? token : undefined
}

/**
 * Whether a request carries a live bearer session. Returns false when:
 * - the request has no `Authorization: Bearer <token>` header,
 * - the host does not have an identity service mounted (no auth seam),
 * - the service rejects the token (unknown, expired, or revoked).
 * @param request - request headers carrying the optional bearer token.
 * @param ctx - host context that may provide the identity service.
 * @returns Whether the bearer token resolves to a live account session.
 */
export async function isAuthenticatedApiRequest(request: AuthenticatedApiRequest, ctx: Context): Promise<boolean> {
  return (await authenticateApiRequest(request, ctx)) !== undefined
}

/**
 * Resolve the carrier identity, retaining the user id for downstream RPCs.
 * @param request - request headers carrying the optional bearer token.
 * @param ctx - host context that may provide the identity service.
 * @returns The authenticated account principal, or undefined when authentication fails.
 */
export async function authenticateApiRequest(request: AuthenticatedApiRequest, ctx: Context): Promise<RpcPrincipal | undefined> {
  const token = extractBearerToken(request.headers)
  if (token === undefined) return undefined
  const identity = ctx.get('identity') as BearerValidatingService | undefined
  if (identity === undefined) return undefined
  try {
    const view = await identity.validate({ sessionToken: token })
    return view === null ? undefined : { kind: 'account', userId: view.userId }
  } catch {
    return undefined
  }
}

function header(headers: BearerHeaders, name: string): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined
  const value = headers[name]
  return typeof value === 'string' ? value : undefined
}
