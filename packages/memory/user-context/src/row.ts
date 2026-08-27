/**
 * Row decoder + sentinel helpers for the user-context seam.
 *
 * Splitting row decoding from the SQLite store keeps the store's responsibility
 * to "what query / what result" while row.ts owns "given an unknown row, prove
 * it's the shape we stored." A bad row shape from a future schema bump
 * surfaces as a `TypeError`, not a silent data-corruption downstream.
 */
import type { UserContextEntry, UserContextKind, UserContextKey } from './types.ts'

/** SQLite stores `''` for "global" entries; the public API surfaces `null`. */
export const GLOBAL_WORKSPACE_ID = ''

/**
 * Convert public global-scope spellings to the SQLite sentinel.
 * @param value Workspace id.
 * @returns Stored workspace id.
 */
export function normalizeWorkspaceId(value: string | null | undefined): string {
  if (value === null || value === undefined || value.length === 0) return GLOBAL_WORKSPACE_ID
  return value
}

function requireInt(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new TypeError(`user-context: stored ${name} must be a safe integer`)
  }
  return value
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string') {
    throw new TypeError(`user-context: stored ${name} must be a string`)
  }
  return value
}

/**
 * Decode one row from the `user_context` table into the public entry shape.
 * @param value Unknown database row.
 * @returns Validated public entry.
 */
export function decodeUserContextRow(value: unknown): UserContextEntry {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('user-context: stored row must be an object')
  }
  const row = value as Record<string, unknown>
  const kind = requireString(row['kind'], 'kind') as UserContextKind
  const key = requireString(row['key'], 'key') as UserContextKey
  const workspaceId = requireString(row['workspace_id'], 'workspace_id')
  return {
    kind,
    key,
    workspaceId: workspaceId === GLOBAL_WORKSPACE_ID ? null : workspaceId,
    value: requireString(row['value'], 'value'),
    updatedAt: requireInt(row['updated_at'], 'updated_at'),
    createdAt: requireInt(row['created_at'], 'created_at'),
  }
}
