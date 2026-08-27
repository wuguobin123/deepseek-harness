/**
 * SQLite-backed identity store. Owns one `DatabaseSync` connection over
 * `<dshHome>/identity.sqlite`; the abstract {@link IdentityService} operates
 * against this typed surface.
 *
 * Layout: `users` (one row per account), `sessions` (one row per issued token),
 * and `invitations` (one digest plus optional encrypted code per lifetime issue), all linked by
 * foreign keys. Schema version lives in `PRAGMA user_version`; the file is
 * created owner-only (mode `0o600`) inside an owner-only (`0o700`) directory.
 *
 * Why a dedicated file (not `ctx.storage.kv`):
 *   - `users.email` needs `UNIQUE` — the storage hub's KV facet is one
 *     `key TEXT PRIMARY KEY` per unit table, no second-column uniqueness.
 *   - `sessions.user_id` needs `REFERENCES users(user_id) ON DELETE CASCADE`
 *     — the storage hub's KV facade does not expose FK DDL.
 *   - Both can stand alone from session-persistence-sqlite's checkpointer,
 *     so owning the file costs nothing and keeps the index scans off that
 *     hot path.
 *
 * `node:sqlite` (Node 22.5+) provides `DatabaseSync`; the engines range
 * `^22.19 || >=24` covers it. The constructor is synchronous, so the store
 * surface is too — Cordis boots are synchronous up to the first `await`.
 */

import { DatabaseSync } from 'node:sqlite'
import { randomBytes } from 'node:crypto'
import { mkdir, open } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { InvitationId, SessionToken, UserId } from './types.ts'

/** Current schema version. Bumped only on breaking layout changes. */
export const SCHEMA_VERSION = 3
/** Application id stamped into the SQLite header for cross-tool discovery. */
export const APPLICATION_ID = 0x44534849 // 'DSHI'
/** Owner-only database file mode (POSIX only; Windows ignores). */
const FILE_MODE = 0o600
/** Owner-only parent-directory mode. */
const DIR_MODE = 0o700

/** A row from the `users` table. */
export interface UserRow {
  readonly user_id: string
  readonly email: string
  readonly password_hash: string
  readonly display_name: string | null
  readonly created_at: number
}

/** A row from the `sessions` table. */
export interface SessionRow {
  readonly token: string
  readonly user_id: string
  readonly created_at: number
  readonly expires_at: number
  readonly last_seen_at: number
  readonly user_agent: string | null
}

/** Persisted invitation metadata. Plaintext codes are deliberately absent. */
export interface InvitationRow {
  readonly invitation_id: string
  readonly owner_id: string
  readonly code_digest: string
  readonly code_suffix: string
  readonly created_at: number
  readonly expires_at: number
  readonly consumed_at: number | null
  readonly redeemed_by: string | null
  readonly code_ciphertext: string | null
}

const SCHEMA_DDL = `
  CREATE TABLE IF NOT EXISTS users (
    user_id        TEXT PRIMARY KEY,
    email          TEXT NOT NULL UNIQUE,
    password_hash  TEXT NOT NULL,
    display_name   TEXT,
    created_at     INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS sessions (
    token          TEXT PRIMARY KEY,
    user_id        TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    created_at     INTEGER NOT NULL,
    expires_at     INTEGER NOT NULL,
    last_seen_at   INTEGER NOT NULL,
    user_agent     TEXT
  ) STRICT;
  CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions(user_id);
  CREATE TABLE IF NOT EXISTS invitations (
    invitation_id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    code_digest TEXT NOT NULL UNIQUE,
    code_suffix TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    consumed_at INTEGER,
    redeemed_by TEXT REFERENCES users(user_id),
    code_ciphertext TEXT
  ) STRICT;
  CREATE INDEX IF NOT EXISTS invitations_owner_id ON invitations(owner_id);
`

/* jscpd:ignore-start -- deliberately mirrors packages/storage/storage-sqlite/
   schema.ts open sequence: same owner-only file create, same mkdir mode, same
   `user_version` stamp, same REJECT-not-migrate posture. One reviewer-readable
   shape for every workspace-owned SQLite file; the unit-record tables are the
   only divergence. */
/** Create the database file owner-only when it does not exist. */
async function createDatabaseFile(path: string): Promise<void> {
  try {
    const handle = await open(path, 'wx', FILE_MODE)
    await handle.close()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

/** Open and validate the identity database; run schema; stamp the version.
 * @param path Database path, or `:memory:` for an in-memory database.
 * @returns An initialized synchronous SQLite handle.
 */
export async function openIdentityDatabase(path: string): Promise<DatabaseSync> {
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
      // Reject unversioned-but-non-empty databases: somebody else owns this
      // file or it is half-materialized; refusing is safer than rewriting.
      throw new Error(
        `identity database at "${actual}" has application id ${onDiskApplication}, expected 0 or ${APPLICATION_ID}`,
      )
    }
    if (onDiskVersion !== 0 && onDiskVersion !== SCHEMA_VERSION) {
      throw new Error(
        `identity database at "${actual}" has schema version ${onDiskVersion}, incompatible with this build (${SCHEMA_VERSION})`,
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
 * Validate one SQLite row to {@link UserRow}. The `unknown` row reaches us
 * from `DatabaseSync` and we trust its column types at the typed same-process
 * boundary, so this is a structural narrowing helper for `noUncheckedIndexedAccess`.
 * @param value Raw SQLite row.
 * @returns The validated user row.
 */
export function decodeUserRow(value: unknown): UserRow {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('identity: stored user row must be an object')
  }
  const row = value as Record<string, unknown>
  if (typeof row['user_id'] !== 'string') throw new TypeError('identity: stored user_id must be a string')
  if (typeof row['email'] !== 'string') throw new TypeError('identity: stored email must be a string')
  if (typeof row['password_hash'] !== 'string') throw new TypeError('identity: stored password_hash must be a string')
  const displayName = row['display_name']
  if (displayName !== null && typeof displayName !== 'string') {
    throw new TypeError('identity: stored display_name must be a string or null')
  }
  if (typeof row['created_at'] !== 'number' || !Number.isSafeInteger(row['created_at'])) {
    throw new TypeError('identity: stored created_at must be a safe integer')
  }
  return {
    user_id: row['user_id'],
    email: row['email'],
    password_hash: row['password_hash'],
    display_name: displayName,
    created_at: row['created_at'],
  }
}

/** Narrow one SQLite row to {@link SessionRow}.
 * @param value Raw SQLite row.
 * @returns The validated session row.
 */
export function decodeSessionRow(value: unknown): SessionRow {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('identity: stored session row must be an object')
  }
  const row = value as Record<string, unknown>
  if (typeof row['token'] !== 'string') throw new TypeError('identity: stored token must be a string')
  if (typeof row['user_id'] !== 'string') throw new TypeError('identity: stored user_id must be a string')
  const createdAt = row['created_at']
  if (typeof createdAt !== 'number' || !Number.isSafeInteger(createdAt)) {
    throw new TypeError('identity: stored created_at must be a safe integer')
  }
  const expiresAt = row['expires_at']
  if (typeof expiresAt !== 'number' || !Number.isSafeInteger(expiresAt)) {
    throw new TypeError('identity: stored expires_at must be a safe integer')
  }
  const lastSeenAt = row['last_seen_at']
  if (typeof lastSeenAt !== 'number' || !Number.isSafeInteger(lastSeenAt)) {
    throw new TypeError('identity: stored last_seen_at must be a safe integer')
  }
  const userAgent = row['user_agent']
  if (userAgent !== null && typeof userAgent !== 'string') {
    throw new TypeError('identity: stored user_agent must be a string or null')
  }
  return {
    token: row['token'],
    user_id: row['user_id'],
    created_at: createdAt,
    expires_at: expiresAt,
    last_seen_at: lastSeenAt,
    user_agent: userAgent,
  }
}

/** Narrow one SQLite invitation row.
 * @param value Raw SQLite row.
 * @returns Validated invitation row.
 */
export function decodeInvitationRow(value: unknown): InvitationRow {
  if (typeof value !== 'object' || value === null) throw new TypeError('identity: stored invitation row must be an object')
  const row = value as Record<string, unknown>
  for (const key of ['invitation_id', 'owner_id', 'code_digest', 'code_suffix'] as const) {
    if (typeof row[key] !== 'string') throw new TypeError(`identity: stored ${key} must be a string`)
  }
  for (const key of ['created_at', 'expires_at'] as const) {
    if (typeof row[key] !== 'number' || !Number.isSafeInteger(row[key])) throw new TypeError(`identity: stored ${key} must be a safe integer`)
  }
  for (const key of ['consumed_at', 'redeemed_by'] as const) {
    if (row[key] !== null && typeof row[key] !== (key === 'consumed_at' ? 'number' : 'string')) throw new TypeError(`identity: stored ${key} has invalid type`)
  }
  if (row['code_ciphertext'] !== null && typeof row['code_ciphertext'] !== 'string') throw new TypeError('identity: stored code_ciphertext has invalid type')
  return row as unknown as InvitationRow
}

/**
 * The opened store plus typed query helpers. Returned by
 * {@link openIdentityDatabase} wrapped in a small lifecycle object so the
 * {@link IdentityService} implementation can own it as a private field.
 */
export class IdentityStore {
  private readonly db: DatabaseSync
  /** Set at dispose: refuse new writes after teardown. */
  private closed = false

  constructor(db: DatabaseSync) {
    this.db = db
  }

  /** Find one user by email (case-sensitive — emails are case-normalized at signup).
   * @param email Normalized email address.
   * @returns The user row when present.
   */
  findUserByEmail(email: string): UserRow | undefined {
    const row = this.db.prepare('SELECT * FROM users WHERE email = ?').get(email)
    return row === undefined ? undefined : decodeUserRow(row)
  }

  /** Find one user by id.
   * @param userId Opaque account identifier.
   * @returns The user row when present.
   */
  findUserById(userId: UserId): UserRow | undefined {
    const row = this.db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId)
    return row === undefined ? undefined : decodeUserRow(row)
  }

  /** Count users — used to gate the bootstrap admin path.
   * @returns Number of stored users.
   */
  countUsers(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }
    return row.n
  }

  /** Count invitations issued by one owner for the lifetime allowance.
   * @param ownerId Owner identifier.
   * @returns Number of invitations issued.
   */
  countInvitations(ownerId: UserId): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM invitations WHERE owner_id = ?').get(ownerId) as { n: number }
    return row.n
  }

  /** Insert an invitation.
   * @param row Invitation metadata without plaintext.
   */
  insertInvitation(row: InvitationRow): void {
    this.db.prepare('INSERT INTO invitations (invitation_id, owner_id, code_digest, code_suffix, created_at, expires_at, consumed_at, redeemed_by, code_ciphertext) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      row.invitation_id,
      row.owner_id,
      row.code_digest,
      row.code_suffix,
      row.created_at,
      row.expires_at,
      row.consumed_at,
      row.redeemed_by,
      row.code_ciphertext,
    )
  }

  /** Find one invitation owned by an account.
   * @param invitationId Invitation identifier.
   * @param ownerId Owner identifier.
   * @returns The invitation row when it belongs to the owner.
   */
  findInvitationByIdForOwner(invitationId: InvitationId, ownerId: UserId): InvitationRow | undefined {
    const row = this.db.prepare('SELECT * FROM invitations WHERE invitation_id = ? AND owner_id = ?').get(invitationId, ownerId)
    return row === undefined ? undefined : decodeInvitationRow(row)
  }

  /** Replace an active invitation's digest, suffix, and encrypted code atomically.
   * @param invitationId Invitation identifier.
   * @param ownerId Owner identifier.
   * @param digest Replacement keyed digest.
   * @param suffix Replacement display suffix.
   * @param ciphertext Replacement encrypted code.
   * @param now Current unix time in milliseconds.
   * @returns Whether one active owned row was replaced.
   */
  rotateInvitation(invitationId: InvitationId, ownerId: UserId, digest: string, suffix: string, ciphertext: string, now: number): boolean {
    const result = this.db.prepare('UPDATE invitations SET code_digest = ?, code_suffix = ?, code_ciphertext = ? WHERE invitation_id = ? AND owner_id = ? AND consumed_at IS NULL AND expires_at > ?').run(digest, suffix, ciphertext, invitationId, ownerId, now)
    return result.changes === 1
  }

  /** Find an invitation by its keyed digest.
   * @param digest HMAC digest.
   * @returns Matching row, if any.
   */
  findInvitationByDigest(digest: string): InvitationRow | undefined {
    const row = this.db.prepare('SELECT * FROM invitations WHERE code_digest = ?').get(digest)
    return row === undefined ? undefined : decodeInvitationRow(row)
  }

  /** List invitations owned by one account.
   * @param ownerId Owner identifier.
   * @returns Invitation rows.
   */
  listInvitations(ownerId: UserId): InvitationRow[] {
    return this.db.prepare('SELECT * FROM invitations WHERE owner_id = ? ORDER BY created_at, invitation_id').all(ownerId).map(decodeInvitationRow)
  }

  /** Mark a still-unused invitation as redeemed.
   * @param invitationId Invitation identifier.
   * @param consumedAt Redemption time.
   * @param redeemedBy New user identifier.
   */
  consumeInvitation(invitationId: InvitationId, consumedAt: number, redeemedBy: UserId): void {
    this.db.prepare('UPDATE invitations SET consumed_at = ?, redeemed_by = ? WHERE invitation_id = ? AND consumed_at IS NULL').run(consumedAt, redeemedBy, invitationId)
  }

  /** Run statements under a writer lock, rolling back on any exception.
   * @param fn Transaction body.
   * @returns The transaction body's result.
   */
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try { const result = fn(); this.db.exec('COMMIT'); return result } catch (error) { try { this.db.exec('ROLLBACK') } catch { /* rollback is best effort after the original failure */ } throw error }
  }

  /** Insert one user. Throws `UNIQUE` constraint failure when email is taken.
   * @param input User fields to persist.
   */
  insertUser(input: { userId: UserId; email: string; passwordHash: string; displayName: string | null; createdAt: number }): void {
    this.db.prepare(
      'INSERT INTO users (user_id, email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(input.userId, input.email, input.passwordHash, input.displayName, input.createdAt)
  }

  /** Insert one session. Throws `PRIMARY KEY` constraint failure on token collision.
   * @param input Session fields to persist.
   */
  insertSession(input: SessionRow): void {
    this.db.prepare(
      'INSERT INTO sessions (token, user_id, created_at, expires_at, last_seen_at, user_agent) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(
      input.token,
      input.user_id,
      input.created_at,
      input.expires_at,
      input.last_seen_at,
      input.user_agent,
    )
  }

  /** Find one session row by token.
   * @param token Opaque session token.
   * @returns The session row when present.
   */
  findSession(token: SessionToken): SessionRow | undefined {
    const row = this.db.prepare('SELECT * FROM sessions WHERE token = ?').get(token)
    return row === undefined ? undefined : decodeSessionRow(row)
  }

  /** Refresh `last_seen_at` for an existing session (called from validate()).
   * @param token Opaque session token.
   * @param lastSeenAt Unix time in milliseconds.
   */
  touchSession(token: SessionToken, lastSeenAt: number): void {
    this.db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token = ?').run(lastSeenAt, token)
  }

  /** Remove one session (signout). Returns the number of rows deleted (0 or 1).
   * @param token Opaque session token.
   * @returns Number of rows deleted.
   */
  removeSession(token: SessionToken): number {
    const result = this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
    return Number(result.changes)
  }

  /** Close the underlying handle; idempotent. */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.db.close()
  }

  /** Whether {@link close} has run.
   * @returns True after the store has been closed.
   */
  isClosed(): boolean {
    return this.closed
  }
}

/** Mint a fresh opaque session token: 32 random bytes, urlsafe base64.
 * @returns A newly generated session token.
 */
export function createSessionToken(): SessionToken {
  return randomBytes(32).toString('base64url') as SessionToken
}

/** Mint a fresh opaque user id: 16 random bytes, urlsafe base64.
 * @returns A newly generated user identifier.
 */
export function createUserId(): UserId {
  return randomBytes(16).toString('base64url') as UserId
}

/** `now` in milliseconds since epoch — extracted for test injection.
 * @returns Current Unix time in milliseconds.
 */
export function nowMillis(): number {
  return Date.now()
}
