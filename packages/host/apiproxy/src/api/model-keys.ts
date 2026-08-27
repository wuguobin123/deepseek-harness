/**
 * Model-keys domain contract — wire projection of `ctx.userModelKeys` for
 * the multi-user xiaowei backend.
 *
 * The seam is one Service Definition (`UserModelKeyService` in
 * `@deepseek-ai/dsh-account-model-keys`) plus three unary methods. Two are
 * loopback-only (provision / revoke) — the host decides when to mint and
 * retire a key — and one (list) is loopback OR bearer so the signed-in
 * user may read their own metadata.
 *
 * Upstream bearer tokens never cross this wire. Provision/revoke are local
 * management operations; account principals may only list their own rows.
 *
 * Branded `KeyId` / `UserId` ride the wire as strings carrying the same
 * opaque brand strings the model-keys and identity packages use; the api/
 * layer is browser-safe and cannot import the brand primitive, so the
 * cast happens at the host seam call site.
 */

import type { RpcRequest, RpcResponse } from './rpc.ts'

/** Wire-side opaque user id brand. Mirrors `UserId` from dsh-account-identity. */
export type UserId = string

/** Wire-side opaque row PK. Mirrors `KeyId` from dsh-account-model-keys. */
export type KeyId = string

/** One metadata row carried by `list()`. Never includes the plaintext. */
export interface ModelKeyView {
  keyId: KeyId
  userId: UserId
  label: string
  createdAt: number
  lastUsedAt: number | null
  revokedAt: number | null
  providerRoute: string
  apiBaseUrl: string
  model: string
  inputPriceMicrosPerToken: number
  outputPriceMicrosPerToken: number
}

/** `provision()`'s return: metadata only. */
export interface ProvisionedKey {
  keyId: KeyId
  userId: UserId
  label: string
  createdAt: number
}

/** Model-keys-domain unary methods (the map keys account.modelKeys.* of RpcMethodMap). */
export interface ModelKeysApi {
  /**
   * Ensure one active upstream credential. Local-principal only.
   * Repeated calls return the existing active metadata for the route.
   */
  provision(request: RpcRequest<{
    userId?: UserId
    /** Optional human-readable label; 1..64 chars. */
    label?: string
  }>): Promise<RpcResponse<ProvisionedKey>>

  /**
   * Return metadata rows. Account principals are restricted to their own user.
   */
  list(request: RpcRequest<{
    userId?: UserId
  }>): Promise<RpcResponse<{ items: ModelKeyView[] }>>

  /**
   * Mark `keyId` as revoked. Local-principal only; account calls are forbidden.
   */
  revoke(request: RpcRequest<{
    keyId: KeyId
  }>): Promise<RpcResponse<{ revoked: boolean }>>
}
