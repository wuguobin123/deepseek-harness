/**
 * SQLite-backed user-context store. Owns one `DatabaseSync` connection over
 * `<dshHome>/user-context.sqlite`; the abstract {@link UserContextStore}
 * operates against this typed surface.
 *
 * Schema: a single `user_context` table with `(kind, key, workspace_id)` PK.
 * The `workspace_id` column uses the empty string as the "global" sentinel
 * (`NULL` would defeat UNIQUE — see SQLite PK semantics); the public API
 * translates `null | undefined | ''` ↔ `''` at the boundary.
 *
 * Why a dedicated file (not reusing `identity.sqlite` or `dsh-storage-sqlite`):
 *   - User memory is the user-controlled surface; backups / retention have a
 *     cadence that is independent of auth state.
 *   - The store has no FK back to `users` (a deleted user keeps their memory
 *     until a future retention sweep decides otherwise — same as the wallet
 *     store). Co-locating with `identity` would invite accidental coupling.
 *
 * `node:sqlite` (Node 22.5+) provides `DatabaseSync`; the engines range
 * `^22.19 || >=24` covers it. Constructor is synchronous; the Cordis boot
 * opens the database inside `[Service.init]` and yields a disposer.
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdir, open } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { decodeUserContextRow, GLOBAL_WORKSPACE_ID, normalizeWorkspaceId } from './row.ts'
import type { UserContextEntry, UserContextKind, UserContextKey, UserContextListResult } from './types.ts'

/** Current schema version. Bumped only on breaking layout changes. */
export const SCHEMA_VERSION = 1
/** Application id stamped into the SQLite header for cross-tool discovery. */
export const APPLICATION_ID = 0x44534855 // 'DSHU'
const FILE_MODE = 0o600
const DIR_MODE = 0o700

const SCHEMA_DDL = `
  CREATE TABLE IF NOT EXISTS user_context (
    kind          TEXT NOT NULL,
    key           TEXT NOT NULL,
    workspace_id  TEXT NOT NULL DEFAULT '',
    value         TEXT NOT NULL,
    updated_at    INTEGER NOT NULL,
    created_at    INTEGER NOT NULL,
    PRIMARY KEY (kind, key, workspace_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS user_context_workspace ON user_context(workspace_id);
  CREATE INDEX IF NOT EXISTS user_context_kind ON user_context(kind);
  CREATE INDEX IF NOT EXISTS user_context_updated_at ON user_context(updated_at DESC);
`

/* jscpd:ignore-start -- mirrors the open sequence used in every workspace-
   owned SQLite file: owner-only create, mkdir mode, application_id stamp,
   user_version stamp, REJECT-not-migrate. The DDL is the only divergence. */
async function createDatabaseFile(path: string): Promise<void> {
  try {
    const handle = await open(path, 'wx', FILE_MODE)
    await handle.close()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

/**
 * Open and validate the user-context database; run schema; stamp the version.
 * @param path Database path or `:memory:`.
 * @returns Open database connection.
 */
export async function openUserContextDatabase(path: string): Promise<DatabaseSync> {
  const actual = path === ':memory:' ? path : resolve(path)
  if (actual !== ':memory:') {
    await mkdir(dirname(actual), { recursive: true, mode: DIR_MODE })
    await createDatabaseFile(actual)
  }
  const db = new DatabaseSync(actual)
  try {
    db.exec('PRAGMA foreign_keys = ON')
    db.exec('PRAGMA journal_mode = WAL')
    const header = db.prepare('PRAGMA application_id').get() as { application_id: number }
    const versionRow = db.prepare('PRAGMA user_version').get() as { user_version: number }
    const onDiskVersion = versionRow.user_version
    const onDiskApplication = header.application_id
    if (onDiskVersion === 0 && onDiskApplication !== 0) {
      throw new Error(
        `user-context database at "${actual}" has application id ${onDiskApplication}, expected 0 or ${APPLICATION_ID}`,
      )
    }
    if (onDiskVersion !== 0 && onDiskVersion !== SCHEMA_VERSION) {
      throw new Error(
        `user-context database at "${actual}" has schema version ${onDiskVersion}, incompatible with this build (${SCHEMA_VERSION})`,
      )
    }
    db.exec(SCHEMA_DDL)
    if (onDiskVersion === 0) {
      db.exec(`PRAGMA application_id = ${APPLICATION_ID}`)
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
    }
    return db
  } catch (error: unknown) {
    db.close()
    throw error
  }
}
/* jscpd:ignore-end */

/**
 * Return the current Unix timestamp in milliseconds.
 * @returns Current timestamp.
 */
export function nowMillis(): number {
  return Date.now()
}

/**
 * SQLite-backed user-context store. Returned by
 * {@link openUserContextDatabase} wrapped in a small lifecycle object so the
 * {@link UserContextStore} implementation can own it as a private field.
 */
export class UserContextDb {
  private readonly db: DatabaseSync
  private closed = false

  constructor(db: DatabaseSync) {
    this.db = db
  }

  /**
   * Find one row by `(kind, key, workspaceId)`. Returns `null` when the row
   * is absent; the caller distinguishes `''` (empty value) from "missing"
   * because decoding `null` here is unambiguous.
   * @param kind Memory category.
   * @param key Opaque slot key.
   * @param workspaceId Workspace scope, or `null` for global.
   * @returns Matching entry, or `null` when absent.
   */
  findEntry(kind: UserContextKind, key: UserContextKey, workspaceId: string | null): UserContextEntry | null {
    const normalized = normalizeWorkspaceId(workspaceId)
    const row = this.db.prepare(
      'SELECT kind, key, workspace_id, value, updated_at, created_at FROM user_context WHERE kind = ? AND key = ? AND workspace_id = ?',
    ).get(kind, key, normalized)
    if (row === undefined) return null
    return decodeUserContextRow(row)
  }

  /**
   * List rows for a `kind` filter; `workspaceId` is optional and matches exactly when given.
   * @param input List filters.
   * @returns Matching entries.
   */
  listEntries(input: { kind?: UserContextKind; workspaceId?: string | null; limit?: number }): UserContextListResult {
    const limit = Math.max(1, Math.min(input.limit ?? 200, 1000))
    const clauses: string[] = []
    const params: (string | number)[] = []
    if (input.kind !== undefined) {
      clauses.push('kind = ?')
      params.push(input.kind)
    }
    if (input.workspaceId !== undefined) {
      clauses.push('workspace_id = ?')
      params.push(normalizeWorkspaceId(input.workspaceId))
    }
    const where = clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`
    const rows = this.db.prepare(
      `SELECT kind, key, workspace_id, value, updated_at, created_at FROM user_context ${where} ORDER BY updated_at DESC LIMIT ?`,
    ).all(...params, limit) as unknown[] as Array<Record<string, unknown>>
    const items = rows.map(row => decodeUserContextRow(row))
    return { items }
  }

  /**
   * Upsert one row; bumps `updated_at` on every write and preserves the
   * original `created_at`. Returns the public entry shape so callers can
   * confirm the post-write timestamp.
   * @param input Entry fields and write timestamp.
   * @returns Persisted entry.
   */
  upsertEntry(input: {
    kind: UserContextKind
    key: UserContextKey
    workspaceId: string | null
    value: string
    now: number
  }): UserContextEntry {
    const normalized = normalizeWorkspaceId(input.workspaceId)
    const existing = this.db.prepare(
      'SELECT created_at FROM user_context WHERE kind = ? AND key = ? AND workspace_id = ?',
    ).get(input.kind, input.key, normalized) as { created_at: number } | undefined
    const createdAt = existing?.created_at ?? input.now
    this.db.prepare(`
      INSERT INTO user_context (kind, key, workspace_id, value, updated_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(kind, key, workspace_id) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `).run(input.kind, input.key, normalized, input.value, input.now, createdAt)
    return {
      kind: input.kind,
      key: input.key,
      workspaceId: normalized === GLOBAL_WORKSPACE_ID ? null : normalized,
      value: input.value,
      updatedAt: input.now,
      createdAt,
    }
  }

  /**
   * Delete one row; returns true if a row was removed.
   * @param kind Memory category.
   * @param key Opaque slot key.
   * @param workspaceId Workspace scope, or `null` for global.
   * @returns Whether a row was removed.
   */
  deleteEntry(kind: UserContextKind, key: UserContextKey, workspaceId: string | null): boolean {
    const normalized = normalizeWorkspaceId(workspaceId)
    const result = this.db.prepare(
      'DELETE FROM user_context WHERE kind = ? AND key = ? AND workspace_id = ?',
    ).run(kind, key, normalized)
    return result.changes > 0
  }

  /** Close the database connection; repeated calls are harmless. */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.db.close()
  }

  /**
   * Report whether this store has been closed.
   * @returns True after disposal.
   */
  isClosed(): boolean {
    return this.closed
  }
}
