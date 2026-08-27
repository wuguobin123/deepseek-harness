/**
 * User-context domain contract. Wire projection of the host-side user-context
 * provider (`@deepseek-ai/dsh-user-context`): cross-session, cross-workspace
 * memory for one signed-in user.
 *
 * Method signatures are the source of truth, same as the workspace domain.
 *
 * Authorization: every method requires the bearer session token to belong to
 * the same user that owns the (kind, key) tuple. The host enforces this in
 * api-proxy.ts by resolving `ctx.identity.validate()` and matching the
 * resolved `userId` against the workspaceId's tenant — same shape as the
 * `account.wallet.get` rule that scopes callers to their own wallets.
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { RpcRequest, RpcResponse } from './rpc.ts'

/**
 * Wire-side user-context key brand. Declared here rather than imported from
 * the user-context package: api/ stays browser-importable with zero host-
 * package dependencies; the brand string matches, so both sides agree
 * structurally. Mirrors the same precedent used for {@link WorkspaceId}.
 */
export type UserContextKey = Branded<'UserContextKey'>

/** Reserved memory categories. Closed: a new kind needs an enum entry here. */
export type UserContextKind = 'preference' | 'working' | 'profile'

/** One memory row carried by every `userContext.list` value. */
export interface UserContextView {
  kind: UserContextKind
  /** Opaque slot name. */
  key: UserContextKey
  /** Workspace id for this entry, or `null` when the entry is user-global. */
  workspaceId: string | null
  value: string
  updatedAt: number
  createdAt: number
}

/** user-context-domain unary methods (the map keys userContext.* of RpcMethodMap). */
export interface UserContextApi {
  /**
   * Lists memory entries, newest-first. Filters are optional. An absent
   * `workspaceId` filter returns both global entries AND workspace-scoped
   * ones; pass `null` (or omit) to opt into "global only", pass a concrete
   * workspaceId for one workspace.
   *
   * An unknown `kind` fails with `bad-request` (closed union). The list
   * returns `{ items: [] }` when no row matches.
   */
  list(request: RpcRequest<{
    kind?: UserContextKind
    workspaceId?: string | null
    limit?: number
  }>): Promise<RpcResponse<{ items: UserContextView[] }>>

  /**
   * Reads one memory entry by composite key. Returns `{ missing: true }`
   * when the row is absent — callers distinguish "stored as the empty
   * string" from "no row at all" without throwing.
   *
   * The signed-in bearer must own the (kind, key) tuple; otherwise
   * `unauthorized`.
   */
  get(request: RpcRequest<{
    kind: UserContextKind
    key: UserContextKey
    workspaceId?: string | null
  }>): Promise<RpcResponse<{ entry: UserContextView } | { missing: true }>>

  /**
   * Upserts one memory entry. Existing rows update `value` + `updatedAt`;
   * brand-new rows insert with `createdAt = updatedAt`. The signed-in
   * bearer must own the (kind, key) tuple.
   *
   * Value is capped at 16 KiB; oversized payloads fail with `bad-request`.
   */
  set(request: RpcRequest<{
    kind: UserContextKind
    key: UserContextKey
    workspaceId?: string | null
    value: string
  }>): Promise<RpcResponse<{ entry: UserContextView }>>

  /**
   * Deletes one memory entry. Idempotent: an absent (kind, key) tuple
   * succeeds with `{ removed: false }`. The signed-in bearer must own the
   * tuple.
   */
  delete(request: RpcRequest<{
    kind: UserContextKind
    key: UserContextKey
    workspaceId?: string | null
  }>): Promise<RpcResponse<{ removed: boolean }>>
}
