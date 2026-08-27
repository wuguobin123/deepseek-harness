/**
 * SQLite-backed email-verification code store. Lives in a separate `*.sqlite`
 * file from the identity store (financial / account lifecycle are independent
 * from verification lifecycle).
 *
 * Schema: one row per normalized email, purpose, and invitation id. The code
 * hash is PBKDF2-HMAC-SHA256 (see `./code.ts`); the plaintext code never
 * touches disk.
 *
 * State machine, per bound row:
 *   - last_sent_at + ttl: every successful request extends expiry; code resets.
 *   - attempts: incremented on every wrong `verifyCode`; reset on successful
 *     verification or on a fresh `requestCode`.
 *   - locked_until: when set, every method fails closed until that instant.
 *   - send_count + hour_window_started_at: inputs to the per-email rolling
 *     hourly aggregate across invitation bindings.
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdir, open } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { EmailVerificationRow } from './types.ts'

/** Current schema version. Bumped only on breaking layout changes. */
export const SCHEMA_VERSION = 2
/** Application id stamped into the SQLite header for cross-tool discovery. */
export const APPLICATION_ID = 0x44534850 // 'DSHP'
const FILE_MODE = 0o600
const DIR_MODE = 0o700

const SCHEMA_DDL = `
  CREATE TABLE IF NOT EXISTS email_verification_codes (
    email                  TEXT NOT NULL COLLATE NOCASE,
    purpose                TEXT NOT NULL DEFAULT 'signup',
    invitation_id          TEXT NOT NULL DEFAULT '',
    salt                   BLOB NOT NULL,
    code_hash              BLOB NOT NULL,
    expires_at             INTEGER NOT NULL,
    attempts               INTEGER NOT NULL DEFAULT 0,
    locked_until           INTEGER,
    last_sent_at           INTEGER NOT NULL,
    send_count             INTEGER NOT NULL DEFAULT 0,
    hour_window_started_at INTEGER NOT NULL,
    created_at             INTEGER NOT NULL,
    PRIMARY KEY (email, purpose, invitation_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS email_verification_codes_expiry
    ON email_verification_codes(expires_at);
`

async function createDatabaseFile(path: string): Promise<void> {
  try {
    const handle = await open(path, 'wx', FILE_MODE)
    await handle.close()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

/** Open, validate, and initialize the email-verification SQLite database.
 * @param path Database path, or `:memory:` for an in-memory database.
 * @returns An initialized synchronous SQLite handle.
 */
export async function openVerificationDatabase(path: string): Promise<DatabaseSync> {
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
        `email verification database at "${actual}" has application id ${onDiskApplication}, expected 0 or ${APPLICATION_ID}`,
      )
    }
    if (onDiskVersion !== 0 && onDiskVersion !== SCHEMA_VERSION) {
      throw new Error(
        `email verification database at "${actual}" has schema version ${onDiskVersion}, incompatible with this build (${SCHEMA_VERSION})`,
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

function decodeRow(value: unknown): EmailVerificationRow {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('email-verification: stored row must be an object')
  }
  const row = value as Record<string, unknown>
  if (typeof row['email'] !== 'string') throw new TypeError('email must be a string')
  if (typeof row['purpose'] !== 'string') throw new TypeError('purpose must be a string')
  if (typeof row['invitation_id'] !== 'string') throw new TypeError('invitation_id must be a string')
  // `node:sqlite` returns BLOB columns as `Uint8Array`; the rest of the seam
  // expects Node `Buffer` so PBKDF2 + `timingSafeEqual` accept the value
  // without surprise conversions. Copy once at decode time.
  const salt = toBuffer(row['salt'], 'salt')
  const codeHash = toBuffer(row['code_hash'], 'code_hash')
  function needInt(name: string): number {
    const v = row[name]
    if (typeof v !== 'number' || !Number.isSafeInteger(v)) {
      throw new TypeError(`${name} must be a safe integer`)
    }
    return v
  }
  const expires_at = needInt('expires_at')
  const attempts = needInt('attempts')
  const last_sent_at = needInt('last_sent_at')
  const send_count = needInt('send_count')
  const hour_window_started_at = needInt('hour_window_started_at')
  const created_at = needInt('created_at')
  const lockedUntil = row['locked_until']
  if (lockedUntil !== null && (typeof lockedUntil !== 'number' || !Number.isSafeInteger(lockedUntil))) {
    throw new TypeError('locked_until must be a safe integer or null')
  }
  return {
    email: row['email'],
    purpose: row['purpose'],
    invitation_id: row['invitation_id'],
    salt,
    code_hash: codeHash,
    expires_at,
    attempts,
    locked_until: lockedUntil,
    last_sent_at,
    send_count,
    hour_window_started_at,
    created_at,
  }
}

function toBuffer(value: unknown, name: string): Buffer {
  if (Buffer.isBuffer(value)) return value
  if (value instanceof Uint8Array) return Buffer.from(value)
  throw new TypeError(`${name} must be a Buffer or Uint8Array`)
}

/** Typed persistence operations for verification-code rows. */
export class EmailVerificationStore {
  private readonly db: DatabaseSync
  private closed = false

  constructor(db: DatabaseSync) {
    this.db = db
  }

  /** Find the current verification row for an email address.
   * @param email Normalized email address.
   * @param purpose Verification purpose that owns the code.
   * @param invitationId Invitation bound to the code.
   * @returns The stored row, when present.
   */
  findByEmail(email: string, purpose = 'signup', invitationId = ''): EmailVerificationRow | undefined {
    const row = this.db.prepare('SELECT * FROM email_verification_codes WHERE email = ? AND purpose = ? AND invitation_id = ?').get(email, purpose, invitationId)
    return row === undefined ? undefined : decodeRow(row)
  }

  /** Return the current hourly send aggregate for one normalized email.
   * @param email Normalized email address.
   * @param now Current Unix time in milliseconds.
   * @returns Send count and earliest active window start.
   */
  sendAggregate(email: string, now: number): { sendCount: number; windowStartedAt: number } {
    const row = this.db.prepare('SELECT COALESCE(SUM(send_count), 0) AS send_count, MIN(hour_window_started_at) AS started FROM email_verification_codes WHERE email = ? AND hour_window_started_at > ?').get(email, now - 3_600_000) as { send_count: number; started: number | null }
    return { sendCount: row.send_count, windowStartedAt: row.started ?? now }
  }

  /** Insert or replace a verification row and reset its attempts and lock.
   * @param input Complete row values to persist.
   */
  upsert(input: {
    email: string
    purpose?: string
    invitationId?: string
    salt: Buffer
    codeHash: Buffer
    expiresAt: number
    lastSentAt: number
    sendCount: number
    hourWindowStartedAt: number
    createdAt: number
  }): void {
    this.db.prepare(`
      INSERT INTO email_verification_codes
        (email, purpose, invitation_id, salt, code_hash, expires_at, attempts, locked_until, last_sent_at, send_count, hour_window_started_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?)
      ON CONFLICT(email, purpose, invitation_id) DO UPDATE SET
        salt = excluded.salt,
        code_hash = excluded.code_hash,
        expires_at = excluded.expires_at,
        attempts = 0,
        locked_until = NULL,
        last_sent_at = excluded.last_sent_at,
        send_count = excluded.send_count,
        hour_window_started_at = excluded.hour_window_started_at,
        created_at = excluded.created_at
    `).run(input.email, input.purpose ?? 'signup', input.invitationId ?? '', input.salt, input.codeHash, input.expiresAt, input.lastSentAt, input.sendCount, input.hourWindowStartedAt, input.createdAt)
  }

  /** Increment the failed-attempt count for an email.
   * @param email Email whose row should be updated.
   * @param purpose Verification purpose that owns the row.
   * @param invitationId Invitation bound to the row.
   */
  incrementAttempts(email: string, purpose = 'signup', invitationId = ''): void {
    this.db.prepare('UPDATE email_verification_codes SET attempts = attempts + 1 WHERE email = ? AND purpose = ? AND invitation_id = ?').run(email, purpose, invitationId)
  }

  /** Set the lock expiry for an email row.
   * @param email Email whose row should be updated.
   * @param lockedUntil Unix time in milliseconds when the lock ends.
   * @param purpose Verification purpose that owns the row.
   * @param invitationId Invitation bound to the row.
   */
  lock(email: string, lockedUntil: number, purpose = 'signup', invitationId = ''): void {
    this.db.prepare('UPDATE email_verification_codes SET locked_until = ? WHERE email = ? AND purpose = ? AND invitation_id = ?').run(lockedUntil, email, purpose, invitationId)
  }

  /** Delete the verification row for an email.
   * @param email Email whose row should be removed.
   * @param purpose Verification purpose that owns the row.
   * @param invitationId Invitation bound to the row.
   */
  delete(email: string, purpose = 'signup', invitationId = ''): void {
    this.db.prepare('DELETE FROM email_verification_codes WHERE email = ? AND purpose = ? AND invitation_id = ?').run(email, purpose, invitationId)
  }

  /** Remove rows whose expiry has passed and that are not currently locked.
   * @param now Current Unix time in milliseconds.
   * @returns Number of rows removed.
   */
  purgeExpired(now: number): number {
    const result = this.db.prepare(
      'DELETE FROM email_verification_codes WHERE expires_at <= ? AND (locked_until IS NULL OR locked_until <= ?)',
    ).run(now, now)
    return Number(result.changes)
  }

  /** Close the underlying database handle; repeated calls are safe. */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.db.close()
  }

  /** Report whether this store has been closed.
   * @returns True after {@link close} has completed.
   */
  isClosed(): boolean {
    return this.closed
  }
}
