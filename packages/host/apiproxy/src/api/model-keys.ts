/**
 * Model-keys domain contract — wire projection of `ctx.userModelKeys` for
 * the multi-user workbuddy backend.
 *
 * The seam is one Service Definition (`UserModelKeyService` in
 * `@deepseek-ai/dsh-account-model-keys`) plus three unary methods. Two are
 * loopback-only (provision / revoke) — the host decides when to mint and
 * retire a key — and one (list) is loopback OR bearer so the signed-in
 * user may read their own metadata.
 *
 * `provision()` is the only method that returns the plaintext bearer; the
 * rule that "the secret rides the wire exactly once" is enforced by the
 * request shape (no `keyValue` field on `list()`).
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

/** Wire-side plaintext bearer. Mirrors `KeyValue` from dsh-account-model-keys. */
export type KeyValue = string

/** One metadata row carried by `list()`. Never includes the plaintext. */
export interface ModelKeyView {
  keyId: KeyId
  userId: UserId
  label: string
  createdAt: number
  lastUsedAt: number | null
  revokedAt: number | null
}

/** `provision()`'s return: metadata + the plaintext (visible EXACTLY ONCE). */
export interface ProvisionedKey {
  keyId: KeyId
  userId: UserId
  label: string
  createdAt: number
  /** Plaintext bearer. The caller is responsible for showing it to the user once. */
  keyValue: KeyValue
}

/** Model-keys-domain unary methods (the map keys account.modelKeys.* of RpcMethodMap). */
export interface ModelKeysApi {
  /**
   * Mint one fresh key. The plaintext `keyValue` rides the response EXACTLY
   * ONCE; every later `list()` call returns only metadata. Loopback-only —
   * the host decides when a new key is issued (typically at signup).
   * @throws `model-key-revoked` when the user already has a live key and
   *   `allowMultipleActive` is false (default). A second provision must
   *   follow an explicit revoke.
   */
  provision(request: RpcRequest<{
    userId: UserId
    /** Optional human-readable label; 1..64 chars. */
    label?: string
  }>): Promise<RpcResponse<ProvisionedKey>>

  /**
   * Return the metadata rows for every key owned by `userId`, newest first.
   * Never returns the plaintext. Loopback OR bearer — a signed-in user may
   * read their own key history.
   */
  list(request: RpcRequest<{
    userId: UserId
  }>): Promise<RpcResponse<{ items: ModelKeyView[] }>>

  /**
   * Mark `keyId` as revoked. Idempotent — an unknown or already-revoked key
   * resolves with `{ revoked: false }` rather than throwing. Loopback-only —
   * the host decides when a key is retired (typically an admin script).
   */
  revoke(request: RpcRequest<{
    keyId: KeyId
  }>): Promise<RpcResponse<{ revoked: boolean }>>
}
