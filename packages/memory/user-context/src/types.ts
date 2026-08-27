/**
 * Public types for the user-context seam.
 *
 * The seam models cross-session, cross-workspace memory for one signed-in user.
 * Three `kind`s are reserved by the harness vocabulary; new kinds land as a
 * PR that adds the consumer (UI section, preset field, etc.) and wire method.
 *
 * Workspace boundary: `workspaceId` partitions a key. `preference` / `profile`
 * are usually written with no `workspaceId` (global to the user); `working`
 * carries the active workspace id so reopening an old project surfaces its
 * notes. The store treats `undefined` and the empty string identically.
 *
 * @module @deepseek-ai/dsh-user-context/types
 */
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Reserved memory categories. New kinds add a typed enum entry here. */
export type UserContextKind = 'preference' | 'working' | 'profile'

/** One memory slot — opaque, scoped by the owning (kind, workspaceId?). */
export type UserContextKey = Branded<'UserContextKey'>

/**
 * Brand a plain string at the seam boundary.
 * @param value Plain key text.
 * @returns Branded user-context key.
 */
export function toUserContextKey(value: string): UserContextKey {
  return value as unknown as UserContextKey
}

/**
 * The stored value. Stored as text in SQLite; callers serialize JSON when
 * they want structured values (settings, lists, drafts). Keep payloads small
 * — the seam is for memory, not artifact bytes.
 */
export type UserContextValue = string

/** Public view returned by `get` and `list`. */
export interface UserContextEntry {
  readonly kind: UserContextKind
  readonly key: UserContextKey
  /** Workspace id for this entry, or `null` when the entry is user-global. */
  readonly workspaceId: string | null
  readonly value: UserContextValue
  readonly updatedAt: number
  readonly createdAt: number
}

/**
 * Result of a `get` query. `missing` lets the caller distinguish "stored as
 * the empty string" from "no row at all" without throwing.
 */
export type UserContextGetResult =
  | { found: true; entry: UserContextEntry }
  | { found: false; missing: true }

/** Public list shape returned by `list`; entries are sorted by `updatedAt DESC`. */
export interface UserContextListResult {
  readonly items: readonly UserContextEntry[]
}
