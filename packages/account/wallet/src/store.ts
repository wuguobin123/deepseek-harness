/**
 * SQLite-backed wallet store. Owns one `DatabaseSync` connection over
 * `<dshHome>/wallet.sqlite`; the abstract {@link WalletService} operates
 * against this typed surface.
 *
 * Layout: `wallets` (one row per user, the canonical balance) and
 * `wallet_ledger` (append-only history, idempotency-keyed for daily refresh).
 * A UNIQUE partial index on `idempotency_key` makes the daily refresh
 * cron-style call safe to retry.
 *
 * Why a dedicated file (not `identity.sqlite`):
 *   - Wallet ledger is the financial audit trail; backups and WAL checkpoints
 *     have their own cadence independent of account lifecycle.
 *   - The user-controllable `setQuota` operation is admin-privileged and we
 *     want it scoped to the wallet DB to keep the identity file append-only
 *     at the policy layer (identity only mints / verifies).
 *
 * `node:sqlite` (Node 22.5+) provides `DatabaseSync`; the engines range
 * `^22.19 || >=24` covers it. The constructor is synchronous, so the store
 * surface is too — Cordis boots are synchronous up to the first `await`.
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdir, open } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { LedgerEntry, LedgerReason, UserId, WalletReservation, WalletSettlement } from './types.ts'

/** Current schema version. Bumped only on breaking layout changes. */
export const SCHEMA_VERSION = 2
/** Application id stamped into the SQLite header for cross-tool discovery. */
export const APPLICATION_ID = 0x44534857 // 'DSHW'
const FILE_MODE = 0o600
const DIR_MODE = 0o700

/** A row from the `wallets` table. */
export interface WalletRow {
  readonly user_id: string
  readonly balance_micros: number
  readonly updated_at: number
  readonly created_at: number
}

/** A row from the `wallet_ledger` table. */
export interface LedgerRow {
  readonly id: number
  readonly user_id: string
  readonly delta_micros: number
  readonly reason: string
  readonly balance_after: number
  readonly created_at: number
  readonly idempotency_key: string | null
}

interface ReservationRow {
  readonly reservation_id: string
  readonly user_id: string
  readonly reserved_micros: number
  readonly created_at: number
  readonly expires_at: number
  readonly status: string
  readonly actual_micros: number | null
  readonly settled_at: number | null
  readonly ledger_id: number | null
  readonly settlement_idempotency_key: string | null
}

const SCHEMA_DDL = `
  CREATE TABLE IF NOT EXISTS wallets (
    user_id        TEXT PRIMARY KEY,
    balance_micros INTEGER NOT NULL DEFAULT 0,
    updated_at     INTEGER NOT NULL,
    created_at     INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS wallet_ledger (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         TEXT NOT NULL,
    delta_micros    INTEGER NOT NULL,
    reason          TEXT NOT NULL,
    balance_after   INTEGER NOT NULL,
    created_at      INTEGER NOT NULL,
    idempotency_key TEXT
  ) STRICT;
  CREATE INDEX IF NOT EXISTS wallet_ledger_user
    ON wallet_ledger(user_id, created_at DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS wallet_ledger_idem
    ON wallet_ledger(user_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;
  CREATE TABLE IF NOT EXISTS wallet_reservations (
    reservation_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    reserved_micros INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'settled', 'cancelled')),
    actual_micros INTEGER,
    settled_at INTEGER,
    ledger_id INTEGER,
    settlement_idempotency_key TEXT
  ) STRICT;
  CREATE INDEX IF NOT EXISTS wallet_reservations_active_user
    ON wallet_reservations(user_id, status, expires_at);
`

/* jscpd:ignore-start -- mirrors the open sequence used in every workspace-
   owned SQLite file: owner-only create, mkdir mode, user_version stamp,
   REJECT-not-migrate. The unit-record tables are the only divergence. */
async function createDatabaseFile(path: string): Promise<void> {
  try {
    const handle = await open(path, 'wx', FILE_MODE)
    await handle.close()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

/** Open and validate the wallet database; run schema; stamp the version.
 * @param path SQLite path or `:memory:`.
 * @returns The initialized database handle.
 */
export async function openWalletDatabase(path: string): Promise<DatabaseSync> {
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
        `wallet database at "${actual}" has application id ${onDiskApplication}, expected 0 or ${APPLICATION_ID}`,
      )
    }
    if (onDiskVersion !== 0 && onDiskVersion !== SCHEMA_VERSION) {
      throw new Error(
        `wallet database at "${actual}" has schema version ${onDiskVersion}, incompatible with this build (${SCHEMA_VERSION})`,
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

function requireInt(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new TypeError(`wallet: stored ${name} must be a safe integer`)
  }
  return value
}

/** Decode one wallet row from SQLite.
 * @param value Raw SQLite result.
 * @returns The validated wallet row.
 */
export function decodeWalletRow(value: unknown): WalletRow {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('wallet: stored wallet row must be an object')
  }
  const row = value as Record<string, unknown>
  if (typeof row['user_id'] !== 'string') throw new TypeError('wallet: stored user_id must be a string')
  return {
    user_id: row['user_id'],
    balance_micros: requireInt(row['balance_micros'], 'balance_micros'),
    updated_at: requireInt(row['updated_at'], 'updated_at'),
    created_at: requireInt(row['created_at'], 'created_at'),
  }
}

/** Decode one ledger row from SQLite.
 * @param value Raw SQLite result.
 * @returns The validated ledger row.
 */
export function decodeLedgerRow(value: unknown): LedgerRow {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('wallet: stored ledger row must be an object')
  }
  const row = value as Record<string, unknown>
  if (typeof row['user_id'] !== 'string') throw new TypeError('wallet: stored user_id must be a string')
  if (typeof row['reason'] !== 'string') throw new TypeError('wallet: stored reason must be a string')
  const idem = row['idempotency_key']
  if (idem !== null && typeof idem !== 'string') {
    throw new TypeError('wallet: stored idempotency_key must be a string or null')
  }
  return {
    id: requireInt(row['id'], 'id'),
    user_id: row['user_id'],
    delta_micros: requireInt(row['delta_micros'], 'delta_micros'),
    reason: row['reason'],
    balance_after: requireInt(row['balance_after'], 'balance_after'),
    created_at: requireInt(row['created_at'], 'created_at'),
    idempotency_key: idem,
  }
}

/**
 * SQLite-backed wallet store. Returned by {@link openWalletDatabase} wrapped in
 * a small lifecycle object so the {@link WalletService} implementation can own
 * it as a private field.
 */
export class WalletStore {
  private readonly db: DatabaseSync
  private closed = false

  constructor(db: DatabaseSync) {
    this.db = db
  }

  /** Find one wallet.
   * @param userId Account id.
   * @returns The wallet row when present.
   */
  findWalletByUserId(userId: UserId): WalletRow | undefined {
    const row = this.db.prepare('SELECT * FROM wallets WHERE user_id = ?').get(userId)
    return row === undefined ? undefined : decodeWalletRow(row)
  }

  /**
   * Upsert one ledger entry and atomically adjust the balance.
   *
   * The pair runs in `BEGIN IMMEDIATE` so two concurrent `credit` calls on
   * the same user cannot interleave and produce a stale `balance_after`.
   * The unique partial index on `(user_id, idempotency_key)` blocks the same
   * `idempotencyKey` from being applied twice — the caller maps that error
   * to `DUPLICATE_REFRESH` without touching `wallets`.
   *
   * `insertWallet` is the bootstrap path for a brand-new account; calling it
   * for an existing user is a `UNIQUE` violation.
   * @param input Ledger mutation fields.
   * @returns Resulting balance and ledger row id.
   */
  applyLedgerEntry(input: {
    userId: UserId
    deltaMicros: number
    reason: LedgerReason
    idempotencyKey: string | null
    now: number
  }): { balanceAfter: number; ledgerId: number } {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      // Resolve current row OR bootstrap at zero. `INSERT ... ON CONFLICT`
      // makes the atomic balance bump survive a racing first-time credit.
      const upsert = this.db.prepare(`
        INSERT INTO wallets (user_id, balance_micros, updated_at, created_at)
        VALUES (?, 0, ?, ?)
        ON CONFLICT(user_id) DO NOTHING
      `).run(input.userId, input.now, input.now)
      void upsert

      const current = this.db.prepare('SELECT balance_micros FROM wallets WHERE user_id = ?').get(input.userId) as
        | { balance_micros: number }
        | undefined
      if (current === undefined) {
        // Should be impossible after the INSERT above; defensive throw.
        throw new Error(`wallet: failed to materialize row for user ${input.userId}`)
      }
      const next = current.balance_micros + input.deltaMicros
      if (next < this.activeReservedMicros(input.userId)) {
        // Negative balance is forbidden; the caller wraps this with INSUFFICIENT_BALANCE.
        throw new InsufficientBalanceSignal(current.balance_micros)
      }
      this.db.prepare('UPDATE wallets SET balance_micros = ?, updated_at = ? WHERE user_id = ?')
        .run(next, input.now, input.userId)
      try {
        const result = this.db.prepare(
          'INSERT INTO wallet_ledger (user_id, delta_micros, reason, balance_after, created_at, idempotency_key) VALUES (?, ?, ?, ?, ?, ?)',
        ).run(input.userId, input.deltaMicros, input.reason, next, input.now, input.idempotencyKey)
        this.db.exec('COMMIT')
        return { balanceAfter: next, ledgerId: Number(result.lastInsertRowid) }
      } catch (error) {
        // Idempotency-key collision: surface as `DUPLICATE_REFRESH` after rollback.
        if (isUniqueViolation(error) && input.idempotencyKey !== null) {
          this.db.exec('ROLLBACK')
          throw new DuplicateRefreshSignal(input.idempotencyKey)
        }
        throw error
      }
    } catch (error) {
      try { this.db.exec('ROLLBACK') } catch { /* ignore secondary failure */ }
      throw error
    }
  }

  /**
   * Set the absolute balance. Records a `set-quota` ledger entry with delta =
   * (new - old). If the row is absent the call still creates the wallet at
   * the requested balance (first-time admin provisioning).
   * @param input Absolute-balance mutation fields.
   * @returns The resulting balance.
   */
  setBalance(input: { userId: UserId; balanceMicros: number; reason: LedgerReason; now: number }): { balanceAfter: number } {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const current = this.findWalletByUserId(input.userId)
      const previous = current?.balance_micros ?? 0
      const reserved = this.activeReservedMicros(input.userId)
      if (input.balanceMicros < reserved) throw new InsufficientBalanceSignal(previous - reserved)
      const delta = input.balanceMicros - previous
      this.db.prepare(`
        INSERT INTO wallets (user_id, balance_micros, updated_at, created_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET balance_micros = excluded.balance_micros, updated_at = excluded.updated_at
      `).run(input.userId, input.balanceMicros, input.now, current?.created_at ?? input.now)
      this.db.prepare(
        'INSERT INTO wallet_ledger (user_id, delta_micros, reason, balance_after, created_at, idempotency_key) VALUES (?, ?, ?, ?, ?, NULL)',
      ).run(input.userId, delta, input.reason, input.balanceMicros, input.now)
      this.db.exec('COMMIT')
      return { balanceAfter: input.balanceMicros }
    } catch (error) {
      try { this.db.exec('ROLLBACK') } catch { /* ignore secondary failure */ }
      throw error
    }
  }

  /** Reserve spendable balance and return the existing row for an exact retry.
   * @param input Reservation identity, amount, and timestamps.
   * @returns The durable reservation.
   */
  reserve(input: { userId: UserId; reservationId: string; amountMicros: number; expiresAt: number; now: number }): WalletReservation {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare("UPDATE wallet_reservations SET status = 'cancelled' WHERE status = 'active' AND expires_at <= ?").run(input.now)
      const existing = this.db.prepare('SELECT * FROM wallet_reservations WHERE reservation_id = ?').get(input.reservationId) as unknown
      if (existing !== undefined) {
        const row = decodeReservationRow(existing)
        if (row.user_id !== input.userId || row.reserved_micros !== input.amountMicros) throw new ReservationConflictSignal()
        this.db.exec('COMMIT')
        return toReservation(row)
      }
      const wallet = this.db.prepare('SELECT balance_micros FROM wallets WHERE user_id = ?').get(input.userId) as { balance_micros: number } | undefined
      const balance = wallet?.balance_micros ?? 0
      const reserved = this.activeReservedMicros(input.userId)
      if (balance - reserved < input.amountMicros) throw new InsufficientBalanceSignal(balance - reserved)
      this.db.prepare('INSERT INTO wallet_reservations (reservation_id, user_id, reserved_micros, created_at, expires_at, status) VALUES (?, ?, ?, ?, ?, \'active\')')
        .run(input.reservationId, input.userId, input.amountMicros, input.now, input.expiresAt)
      this.db.exec('COMMIT')
      return {
        userId: input.userId,
        reservationId: input.reservationId,
        reservedMicros: input.amountMicros,
        createdAt: input.now,
        expiresAt: input.expiresAt,
      }
    } catch (error) {
      try { this.db.exec('ROLLBACK') } catch { /* ignore secondary failure */ }
      throw error
    }
  }

  /** Settle an active reservation and append the model-usage ledger row.
   * @param input Reservation identity, actual amount, and idempotency key.
   * @returns The committed settlement.
   */
  settle(input: { userId: UserId; reservationId: string; actualMicros: number; idempotencyKey: string; now: number }): WalletSettlement {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const raw = this.db.prepare('SELECT * FROM wallet_reservations WHERE reservation_id = ?').get(input.reservationId) as unknown
      if (raw === undefined) throw new ReservationNotFoundSignal()
      const row = decodeReservationRow(raw)
      if (row.user_id !== input.userId) throw new ReservationNotFoundSignal()
      if (row.status === 'settled') {
        if (row.actual_micros === null || row.ledger_id === null || row.settled_at === null || row.settlement_idempotency_key === null) throw new Error('wallet: malformed settled reservation')
        if (row.actual_micros !== input.actualMicros
          || row.settlement_idempotency_key !== input.idempotencyKey) {
          throw new ReservationConflictSignal()
        }
        const balance = this.db.prepare('SELECT balance_micros FROM wallets WHERE user_id = ?').get(input.userId) as { balance_micros: number }
        this.db.exec('COMMIT')
        return settlement(row, row.actual_micros, balance.balance_micros, row.ledger_id, row.settled_at)
      }
      if (row.status === 'cancelled') throw new ReservationAlreadyCancelledSignal()
      if (input.actualMicros > row.reserved_micros) throw new ReservationActualExceedsSignal()
      const wallet = this.db.prepare('SELECT balance_micros, created_at FROM wallets WHERE user_id = ?').get(input.userId) as { balance_micros: number; created_at: number } | undefined
      const balance = wallet?.balance_micros ?? 0
      const next = balance - input.actualMicros
      if (next < 0) throw new InsufficientBalanceSignal(balance)
      this.db.prepare('INSERT INTO wallets (user_id, balance_micros, updated_at, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET balance_micros = excluded.balance_micros, updated_at = excluded.updated_at')
        .run(input.userId, next, input.now, wallet?.created_at ?? input.now)
      let ledger
      try {
        ledger = this.db.prepare('INSERT INTO wallet_ledger (user_id, delta_micros, reason, balance_after, created_at, idempotency_key) VALUES (?, ?, \'model-usage\', ?, ?, ?)')
          .run(input.userId, -input.actualMicros, next, input.now, input.idempotencyKey)
      } catch (error) {
        if (isUniqueViolation(error)) throw new ReservationConflictSignal()
        throw error
      }
      const ledgerId = Number(ledger.lastInsertRowid)
      this.db.prepare("UPDATE wallet_reservations SET status = 'settled', actual_micros = ?, settled_at = ?, ledger_id = ?, settlement_idempotency_key = ? WHERE reservation_id = ?")
        .run(input.actualMicros, input.now, ledgerId, input.idempotencyKey, input.reservationId)
      this.db.exec('COMMIT')
      return settlement(row, input.actualMicros, next, ledgerId, input.now)
    } catch (error) {
      try { this.db.exec('ROLLBACK') } catch { /* ignore secondary failure */ }
      throw error
    }
  }

  /** Cancel an active reservation; repeated cancellation is harmless.
   * @param input Reservation identity and cancellation time.
   * @returns The durable reservation view.
   */
  cancel(input: { userId: UserId; reservationId: string; now: number }): WalletReservation {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const raw = this.db.prepare('SELECT * FROM wallet_reservations WHERE reservation_id = ?').get(input.reservationId) as unknown
      if (raw === undefined) throw new ReservationNotFoundSignal()
      const row = decodeReservationRow(raw)
      if (row.user_id !== input.userId) throw new ReservationNotFoundSignal()
      if (row.status === 'settled') throw new ReservationAlreadySettledSignal()
      if (row.status === 'active') this.db.prepare("UPDATE wallet_reservations SET status = 'cancelled' WHERE reservation_id = ?").run(input.reservationId)
      this.db.exec('COMMIT')
      return toReservation(row)
    } catch (error) {
      try { this.db.exec('ROLLBACK') } catch { /* ignore secondary failure */ }
      throw error
    }
  }

  private activeReservedMicros(userId: UserId): number {
    const row = this.db.prepare("SELECT COALESCE(SUM(reserved_micros), 0) AS total FROM wallet_reservations WHERE user_id = ? AND status = 'active'").get(userId) as { total: number }
    return requireInt(row.total, 'reserved_micros')
  }

  /** Return recent ledger entries.
   * @param input Account id and row limit.
   * @returns Newest-first ledger entries.
   */
  listLedger(input: { userId: UserId; limit: number }): LedgerEntry[] {
    const rows = this.db.prepare(
      'SELECT * FROM wallet_ledger WHERE user_id = ? ORDER BY id DESC LIMIT ?',
    ).all(input.userId, input.limit) as unknown[]
    return rows.map(decodeLedgerRow).map(toLedgerEntry)
  }

  /** Close the database handle. */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.db.close()
  }

  /** Report whether the database handle is closed.
   * @returns True after close.
   */
  isClosed(): boolean {
    return this.closed
  }
}

function toLedgerEntry(row: LedgerRow): LedgerEntry {
  return {
    id: row.id,
    userId: row.user_id as UserId,
    deltaMicros: row.delta_micros,
    reason: row.reason as LedgerReason,
    balanceAfter: row.balance_after,
    createdAt: row.created_at,
    idempotencyKey: row.idempotency_key,
  }
}

function decodeReservationRow(value: unknown): ReservationRow {
  if (typeof value !== 'object' || value === null) throw new TypeError('wallet: stored reservation row must be an object')
  const row = value as Record<string, unknown>
  if (typeof row['reservation_id'] !== 'string' || typeof row['user_id'] !== 'string' || typeof row['status'] !== 'string' || !['active', 'settled', 'cancelled'].includes(row['status'])) throw new TypeError('wallet: malformed reservation row')
  const actual = row['actual_micros'] === null ? null : requireInt(row['actual_micros'], 'actual_micros')
  const settledAt = row['settled_at'] === null ? null : requireInt(row['settled_at'], 'settled_at')
  const ledgerId = row['ledger_id'] === null ? null : requireInt(row['ledger_id'], 'ledger_id')
  const settlementKey = row['settlement_idempotency_key'] === null ? null : typeof row['settlement_idempotency_key'] === 'string' ? row['settlement_idempotency_key'] : (() => { throw new TypeError('wallet: stored settlement idempotency key must be a string or null') })()
  if (row['status'] === 'settled' && (actual === null || settledAt === null || ledgerId === null || settlementKey === null)) throw new TypeError('wallet: settled reservation is missing settlement fields')
  if (row['status'] !== 'settled' && (actual !== null || settledAt !== null || ledgerId !== null || settlementKey !== null)) throw new TypeError('wallet: open reservation has settlement fields')
  return {
    reservation_id: row['reservation_id'], user_id: row['user_id'], status: row['status'],
    reserved_micros: requireInt(row['reserved_micros'], 'reserved_micros'),
    created_at: requireInt(row['created_at'], 'created_at'), expires_at: requireInt(row['expires_at'], 'expires_at'),
    actual_micros: actual, settled_at: settledAt, ledger_id: ledgerId, settlement_idempotency_key: settlementKey,
  }
}

function toReservation(row: ReservationRow): WalletReservation {
  return {
    userId: row.user_id as UserId,
    reservationId: row.reservation_id,
    reservedMicros: row.reserved_micros,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  }
}

function settlement(
  row: ReservationRow,
  actualMicros: number,
  balanceMicros: number,
  ledgerId: number,
  updatedAt: number,
): WalletSettlement {
  return {
    userId: row.user_id as UserId,
    reservationId: row.reservation_id,
    reservedMicros: row.reserved_micros,
    actualMicros,
    refundedMicros: row.reserved_micros - actualMicros,
    balanceMicros,
    updatedAt,
    ledgerId,
  }
}

/**
 * Sentinel thrown inside a `BEGIN IMMEDIATE` block when the resulting balance
 * would be negative. The outer provider maps it to a typed
 * `WalletError('INSUFFICIENT_BALANCE', ...)`.
 */
export class InsufficientBalanceSignal extends Error {
  /** Sentinel discriminator. */
  readonly kind = 'InsufficientBalance' as const
  constructor(readonly balanceMicros: number) {
    super('insufficient balance')
  }
}

/** Transaction sentinel for reservation identity or settlement parameter conflicts. */
export class ReservationConflictSignal extends Error {
  /** Sentinel discriminator. */ readonly kind = 'ReservationConflict' as const
}
/** Transaction sentinel for an unknown reservation or foreign owner. */
export class ReservationNotFoundSignal extends Error {
  /** Sentinel discriminator. */ readonly kind = 'ReservationNotFound' as const
}
/** Transaction sentinel for cancelling an already settled reservation. */
export class ReservationAlreadySettledSignal extends Error {
  /** Sentinel discriminator. */ readonly kind = 'ReservationAlreadySettled' as const
}
/** Transaction sentinel for settling an already cancelled reservation. */
export class ReservationAlreadyCancelledSignal extends Error {
  /** Sentinel discriminator. */ readonly kind = 'ReservationAlreadyCancelled' as const
}
/** Transaction sentinel for actual usage greater than the reserved amount. */
export class ReservationActualExceedsSignal extends Error {
  /** Sentinel discriminator. */ readonly kind = 'ReservationActualExceeds' as const
}

/**
 * Sentinel for an idempotency-key collision. The caller maps it to
 * `WalletError('DUPLICATE_REFRESH', ...)` without losing the original key.
 */
export class DuplicateRefreshSignal extends Error {
  /** Sentinel discriminator. */
  readonly kind = 'DuplicateRefresh' as const
  constructor(readonly idempotencyKey: string) {
    super(`duplicate refresh key ${idempotencyKey}`)
  }
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const e = error as { code?: unknown; errno?: unknown; message?: unknown }
  if (e.code === 'SQLITE_CONSTRAINT_UNIQUE' || e.code === 'SQLITE_CONSTRAINT') return true
  if (e.errno === 19 /* SQLITE_CONSTRAINT */) return true
  if (typeof e.message === 'string' && e.message.includes('UNIQUE constraint')) return true
  return false
}

/** Read the current wall-clock time.
 * @returns Unix milliseconds.
 */
export function nowMillis(): number {
  return Date.now()
}
