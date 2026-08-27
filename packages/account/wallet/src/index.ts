/**
 * Service Definition + default SQLite-backed provider for the local xiaowei
 * wallet seam. Durable model-usage reservations hold available balance until
 * settlement or cancellation.
 *
 * The seam owns one numeric type (`AmountMicros = 1_000_000 micros = 1.00 CNY`),
 * one ledger view, and ten public methods (`get` / `credit` / `debit` /
 * `setQuota` / `refreshDaily` / `reserve` / `settle` / `cancel` plus
 * welcome and ledger reads). Settlements write one row to
 * `wallet_ledger`; the canonical balance lives in `wallets`. Wire methods in
 * `packages/host/apiproxy/src/api/wallet.ts` consume the same provider via
 * `ctx.wallet`.
 *
 * Single-package pre-release stance: the abstract `WalletService` and the sole
 * implementation `LocalWalletProvider` live here together. A hosted
 * "model-account" provider (think Stripe-backed quotas) would split this seam
 * into its own package; for now, the SQLite ledger is the only shape the
 * harness needs.
 *
 * Concurrency model:
 *   - Every public method opens a `BEGIN IMMEDIATE` transaction inside the
 *     store, serializing balance writes per user.
 *   - `debit` reads the balance inside the same transaction so a racing
 *     `credit` cannot cause a negative interim balance.
 *   - The unique partial index on `(user_id, idempotency_key)` makes
 *     `refreshDaily` safe to retry: the second call returns
 *     `DUPLICATE_REFRESH` and leaves `wallets` untouched.
 *
 * @module @deepseek-ai/dsh-account-wallet
 */
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  DuplicateRefreshSignal,
  InsufficientBalanceSignal,
  ReservationActualExceedsSignal,
  ReservationAlreadyCancelledSignal,
  ReservationAlreadySettledSignal,
  ReservationConflictSignal,
  ReservationNotFoundSignal,
  WalletStore,
  nowMillis,
  openWalletDatabase,
} from './store.ts'
import {
  MAX_BALANCE_MICROS,
  MAX_DELTA_MICROS,
  WalletError,
  assertAmount,
  assertIdempotencyKey,
  assertReason,
} from './errors.ts'
import type { LedgerEntry, LedgerReason, WalletReservation, WalletSettlement, WalletView } from './types.ts'
import type { UserId } from '@deepseek-ai/dsh-account-identity'

/** Plugin configuration. */
export interface Config {
  /** Path to the SQLite database file (`:memory:` for tests). */
  path: string
  /** Welcome bonus in micros applied at signup (default 20 CNY). */
  welcomeBonusMicros?: number
  /** Optional daily refresh in micros (disabled by default). */
  dailyRefreshMicros?: number
  /** Lifetime of an active model-usage reservation in seconds. */
  reservationTtlSeconds?: number
}

export const Config: z<Config> = z.object({
  path: z.string().required(),
  welcomeBonusMicros: z.number().step(1).min(0).max(MAX_BALANCE_MICROS).default(20_000_000),
  dailyRefreshMicros: z.number().step(1).min(0).max(MAX_DELTA_MICROS).default(0),
  reservationTtlSeconds: z.number().step(1).min(1).max(86_400).default(3_600),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The local wallet provider (Service Definition: `WalletService`). */
    wallet: WalletService
  }
}

/**
 * The Service Definition for the wallet seam. Every implementation owns one
 * `wallets` table and one `wallet_ledger` table; cross-process or hosted
 * providers (Stripe, new-api, etc.) would extend this contract without
 * changing the wire shape.
 */
export abstract class WalletService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'wallet')
  }

  /**
   * Fetch the wallet view for one user. Returns a zero-balance view when the
   * user has no row yet; this is the same default the bootstrap path inserts.
   * @param input.userId The user whose wallet view is requested.
   * @returns A `WalletView` snapshot of the current balance and timestamp.
   */
  abstract get(input: { userId: UserId }): Promise<WalletView>

  /**
   * Add `amountMicros` to the user's balance and append a ledger row.
   * @param input The credit payload.
   * @returns The new wallet view after the credit is applied.
   * @throws WalletError(BAD_REQUEST) on schema-rejected input.
   */
  abstract credit(input: { userId: UserId; amountMicros: number; reason: LedgerReason; idempotencyKey?: string }): Promise<WalletView>

  /**
   * Subtract `amountMicros` from the user's balance; throws when the result
   * would be negative.
   * @param input The debit payload.
   * @returns The new wallet view after the debit is applied.
   * @throws WalletError(INSUFFICIENT_BALANCE) when the balance cannot cover.
   */
  abstract debit(input: { userId: UserId; amountMicros: number; reason: LedgerReason; idempotencyKey?: string }): Promise<WalletView>

  /**
   * Force the balance to `balanceMicros` and append a `set-quota` ledger row.
   * Admin-privileged; wire-layer fence restricts callers to loopback.
   * @param input The quota override payload.
   * @returns The new wallet view after the override is applied.
   */
  abstract setQuota(input: { userId: UserId; balanceMicros: number; reason: LedgerReason }): Promise<WalletView>

  /**
   * Apply the configured daily-refresh amount once. Idempotent by date: a
   * second call with the same `idempotencyKey` returns the prior balance
   * without applying a second delta.
   * @param input The refresh payload (must carry today's idempotency key).
   * @returns The wallet view after the refresh (or the existing one when
   *   the key was already applied today).
   */
  abstract refreshDaily(input: { userId: UserId; idempotencyKey: string }): Promise<WalletView>

  /**
   * Apply the configured welcome bonus. Convenience for `credit`.
   * @param input The user id to credit.
   * @returns The new wallet view after the welcome bonus is applied.
   */
  abstract grantWelcomeBonus(input: { userId: UserId }): Promise<WalletView>

  /**
   * Return the most-recent ledger entries, newest first.
   * @param input.userId The user whose ledger is queried.
   * @param input.limit Optional cap on returned rows (server default applies
   *   when omitted).
   * @returns Newest-first ledger rows.
   */
  abstract listLedger(input: { userId: UserId; limit?: number }): Promise<LedgerEntry[]>

  /** Reserve available balance without changing the reported current balance.
   * @param input.userId Account owning the reservation.
   * @param input.reservationId Stable 1..64-character operation identifier.
   * @param input.amountMicros Non-negative safe-integer amount to hold.
   * @returns The durable active reservation; an exact retry returns the same record.
   * @throws WalletError on invalid input, conflicting identity, or insufficient available balance.
   */
  abstract reserve(input: { userId: UserId; reservationId: string; amountMicros: number }): Promise<WalletReservation>
  /** Settle a reservation and charge actual model usage.
   * @param input.userId Account owning the reservation.
   * @param input.reservationId Reservation to settle.
   * @param input.actualMicros Non-negative usage, no greater than reserved amount.
   * @param input.idempotencyKey Stable ledger idempotency key.
   * @returns The committed settlement; an exact retry returns the same result.
   * @throws WalletError on missing/cancelled reservations, parameter drift, or invalid input.
   */
  abstract settle(input: { userId: UserId; reservationId: string; actualMicros: number; idempotencyKey: string }): Promise<WalletSettlement>
  /** Cancel a reservation and release its hold without writing a ledger row.
   * @param input.userId Account owning the reservation.
   * @param input.reservationId Reservation to cancel.
   * @returns The durable reservation record; repeated cancellation returns the same record.
   * @throws WalletError when the reservation is missing or already settled.
   */
  abstract cancel(input: { userId: UserId; reservationId: string }): Promise<WalletReservation>
}

/**
 * SQLite-backed wallet provider. Singleton per Cordis context.
 *
 * Lifecycle:
 *   - Constructor stores config; the database is opened on first use.
 *   - `[Service.init]` opens `<dshHome>/wallet.sqlite` (WAL, owner-only) and
 *     applies the schema. No bootstrap row is created — the first
 *     `grantWelcomeBonus` (or `credit`) is the bootstrap.
 *   - Disposal closes the underlying handle.
 */
export class LocalWalletProvider extends WalletService {
  static Config = Config

  private storeReady: Promise<WalletStore> | undefined
  private closed = false

  constructor(ctx: Context, public config: Config) {
    super(ctx)
  }

  async *[Service.init](): AsyncGenerator<() => Promise<void> | void, void, void> {
    const store = await this.openStore()
    yield () => {
      this.closed = true
      store.close()
    }
  }

  private openStore(): Promise<WalletStore> {
    if (this.storeReady !== undefined) return this.storeReady
    this.storeReady = (async () => {
      const db = await openWalletDatabase(this.config.path)
      return new WalletStore(db)
    })()
    this.storeReady.catch(() => undefined)
    return this.storeReady
  }

  override async get(input: { userId: UserId }): Promise<WalletView> {
    this.assertUserId(input.userId)
    const store = await this.openStore()
    this.assertOpen(store)
    const row = store.findWalletByUserId(input.userId)
    return {
      userId: input.userId,
      balanceMicros: row?.balance_micros ?? 0,
      updatedAt: row?.updated_at ?? 0,
    }
  }

  override async credit(
    input: { userId: UserId; amountMicros: number; reason: LedgerReason; idempotencyKey?: string },
  ): Promise<WalletView> {
    this.assertUserId(input.userId)
    assertAmount(input.amountMicros, 'amountMicros')
    if (input.amountMicros <= 0) {
      throw new WalletError('BAD_REQUEST', 'credit amountMicros must be positive')
    }
    assertReason(input.reason)
    const idem = input.idempotencyKey ?? null
    if (idem !== null) assertIdempotencyKey(idem)
    const store = await this.openStore()
    this.assertOpen(store)
    const now = nowMillis()
    const result = this.applyLedgerOrThrow(store, {
      userId: input.userId,
      deltaMicros: input.amountMicros,
      reason: input.reason,
      idempotencyKey: idem,
      now,
    })
    return { userId: input.userId, balanceMicros: result.balanceAfter, updatedAt: now }
  }

  override async debit(
    input: { userId: UserId; amountMicros: number; reason: LedgerReason; idempotencyKey?: string },
  ): Promise<WalletView> {
    this.assertUserId(input.userId)
    assertAmount(input.amountMicros, 'amountMicros')
    if (input.amountMicros <= 0) {
      throw new WalletError('BAD_REQUEST', 'debit amountMicros must be positive')
    }
    assertReason(input.reason)
    const idem = input.idempotencyKey ?? null
    if (idem !== null) assertIdempotencyKey(idem)
    const store = await this.openStore()
    this.assertOpen(store)
    const now = nowMillis()
    const result = this.applyLedgerOrThrow(store, {
      userId: input.userId,
      deltaMicros: -input.amountMicros,
      reason: input.reason,
      idempotencyKey: idem,
      now,
    })
    return { userId: input.userId, balanceMicros: result.balanceAfter, updatedAt: now }
  }

  override async setQuota(input: { userId: UserId; balanceMicros: number; reason: LedgerReason }): Promise<WalletView> {
    this.assertUserId(input.userId)
    assertAmount(input.balanceMicros, 'balanceMicros', MAX_BALANCE_MICROS)
    if (input.balanceMicros < 0) {
      throw new WalletError('BAD_REQUEST', 'setQuota balanceMicros must be non-negative')
    }
    assertReason(input.reason)
    const store = await this.openStore()
    this.assertOpen(store)
    const now = nowMillis()
    const result = store.setBalance({ userId: input.userId, balanceMicros: input.balanceMicros, reason: input.reason, now })
    return { userId: input.userId, balanceMicros: result.balanceAfter, updatedAt: now }
  }

  override async refreshDaily(input: { userId: UserId; idempotencyKey: string }): Promise<WalletView> {
    this.assertUserId(input.userId)
    assertIdempotencyKey(input.idempotencyKey)
    const store = await this.openStore()
    this.assertOpen(store)
    const delta = this.config.dailyRefreshMicros ?? 0
    if (delta === 0) {
      // Operator disabled the refresh; return current balance without writing.
      const current = store.findWalletByUserId(input.userId)
      return {
        userId: input.userId,
        balanceMicros: current?.balance_micros ?? 0,
        updatedAt: current?.updated_at ?? 0,
      }
    }
    const now = nowMillis()
    try {
      const result = this.applyLedgerOrThrow(store, {
        userId: input.userId,
        deltaMicros: delta,
        reason: 'daily-refresh',
        idempotencyKey: input.idempotencyKey,
        now,
      })
      return { userId: input.userId, balanceMicros: result.balanceAfter, updatedAt: now }
    } catch (error) {
      if (error instanceof WalletError && error.code === 'DUPLICATE_REFRESH') {
        // Cron-style idempotency: the same key was already applied. Return
        // the current balance so the caller sees a stable view; the ledger
        // remains a single row.
        const current = store.findWalletByUserId(input.userId)
        return {
          userId: input.userId,
          balanceMicros: current?.balance_micros ?? 0,
          updatedAt: current?.updated_at ?? now,
        }
      }
      throw error
    }
  }

  override async grantWelcomeBonus(input: { userId: UserId }): Promise<WalletView> {
    this.assertUserId(input.userId)
    const store = await this.openStore()
    this.assertOpen(store)
    const amountMicros = this.config.welcomeBonusMicros ?? 0
    if (amountMicros === 0) return this.currentView(store, input.userId, 0)
    const now = nowMillis()
    try {
      const result = this.applyLedgerOrThrow(store, {
        userId: input.userId,
        deltaMicros: amountMicros,
        reason: 'welcome',
        idempotencyKey: `welcome:${input.userId}`,
        now,
      })
      return { userId: input.userId, balanceMicros: result.balanceAfter, updatedAt: now }
    } catch (error) {
      if (error instanceof WalletError && error.code === 'DUPLICATE_REFRESH') {
        return this.currentView(store, input.userId, now)
      }
      throw error
    }
  }

  override async listLedger(input: { userId: UserId; limit?: number }): Promise<LedgerEntry[]> {
    this.assertUserId(input.userId)
    const store = await this.openStore()
    this.assertOpen(store)
    return store.listLedger({ userId: input.userId, limit: Math.max(1, Math.min(input.limit ?? 50, 200)) })
  }

  override async reserve(input: { userId: UserId; reservationId: string; amountMicros: number }): Promise<WalletReservation> {
    this.assertUserId(input.userId)
    assertIdempotencyKey(input.reservationId)
    assertAmount(input.amountMicros, 'amountMicros')
    if (input.amountMicros <= 0) throw new WalletError('BAD_REQUEST', 'reservation amountMicros must be positive')
    const store = await this.openStore(); this.assertOpen(store)
    try {
      const now = nowMillis()
      return store.reserve({
        userId: input.userId,
        reservationId: input.reservationId,
        amountMicros: input.amountMicros,
        now,
        expiresAt: now + (this.config.reservationTtlSeconds ?? 3_600) * 1000,
      })
    } catch (error) { throw this.mapReservationError(error, input.userId, input.amountMicros) }
  }

  override async settle(
    input: { userId: UserId; reservationId: string; actualMicros: number; idempotencyKey: string },
  ): Promise<WalletSettlement> {
    this.assertUserId(input.userId)
    assertIdempotencyKey(input.reservationId)
    assertIdempotencyKey(input.idempotencyKey)
    assertAmount(input.actualMicros, 'actualMicros')
    if (input.actualMicros < 0) throw new WalletError('BAD_REQUEST', 'actualMicros must be non-negative')
    const store = await this.openStore(); this.assertOpen(store)
    try {
      return store.settle({ ...input, now: nowMillis() })
    } catch (error) {
      throw this.mapReservationError(error, input.userId, input.actualMicros)
    }
  }

  override async cancel(input: { userId: UserId; reservationId: string }): Promise<WalletReservation> {
    this.assertUserId(input.userId); assertIdempotencyKey(input.reservationId)
    const store = await this.openStore(); this.assertOpen(store)
    try { return store.cancel({ ...input, now: nowMillis() }) } catch (error) { throw this.mapReservationError(error, input.userId) }
  }

  /**
   * Run a ledger write and translate the store's sentinels to typed
   * `WalletError`s. The store stays typed as `unknown` for the thrown error
   * because it can also be an unrelated SQLite error (FK violation, etc.) —
   * those propagate to the caller as the raw `Error` they are.
   */
  private applyLedgerOrThrow(
    store: WalletStore,
    input: { userId: UserId; deltaMicros: number; reason: LedgerReason; idempotencyKey: string | null; now: number },
  ): { balanceAfter: number; ledgerId: number } {
    try {
      return store.applyLedgerEntry(input)
    } catch (error) {
      if (error instanceof InsufficientBalanceSignal) {
        const attempted = input.deltaMicros < 0 ? -input.deltaMicros : input.deltaMicros
        throw new WalletError('INSUFFICIENT_BALANCE', `insufficient balance for user ${input.userId}`, {
          detail: { userId: input.userId, balanceMicros: error.balanceMicros, attemptedMicros: attempted },
        })
      }
      if (error instanceof DuplicateRefreshSignal) {
        throw new WalletError('DUPLICATE_REFRESH', `daily refresh already applied for key ${error.idempotencyKey}`)
      }
      throw error
    }
  }

  private assertUserId(value: unknown): asserts value is UserId {
    if (typeof value !== 'string' || value.length === 0 || value.length > 64) {
      throw new WalletError('BAD_REQUEST', 'userId length must be 1..64')
    }
  }

  private mapReservationError(error: unknown, userId: UserId, attemptedMicros: number = 0): unknown {
    if (error instanceof InsufficientBalanceSignal) return new WalletError('INSUFFICIENT_BALANCE', `insufficient available balance for user ${userId}`, { detail: { userId, balanceMicros: error.balanceMicros, attemptedMicros } })
    if (error instanceof ReservationConflictSignal) return new WalletError('RESERVATION_CONFLICT', 'reservation id is already used with different parameters')
    if (error instanceof ReservationNotFoundSignal) return new WalletError('RESERVATION_NOT_FOUND', 'reservation was not found')
    if (error instanceof ReservationAlreadySettledSignal) return new WalletError('RESERVATION_ALREADY_SETTLED', 'reservation is already settled')
    if (error instanceof ReservationAlreadyCancelledSignal) return new WalletError('RESERVATION_ALREADY_CANCELLED', 'reservation is already cancelled')
    if (error instanceof ReservationActualExceedsSignal) return new WalletError('RESERVATION_ACTUAL_EXCEEDS_RESERVED', 'actual usage exceeds reserved amount')
    return error
  }

  private currentView(store: WalletStore, userId: UserId, fallbackUpdatedAt: number): WalletView {
    const current = store.findWalletByUserId(userId)
    return {
      userId,
      balanceMicros: current?.balance_micros ?? 0,
      updatedAt: current?.updated_at ?? fallbackUpdatedAt,
    }
  }

  /** Fail fast after disposal; covers the edge where a public method runs past teardown. */
  private assertOpen(store: WalletStore): void {
    if (this.closed || store.isClosed()) {
      throw new WalletError('WALLET_UNAVAILABLE', 'wallet provider has been disposed')
    }
  }
}

export default LocalWalletProvider

/** Re-export types and helpers for consumers that prefer a single import. */
export type { AmountMicros, LedgerEntry, LedgerReason, WalletView, WalletReservation, WalletSettlement, InsufficientBalanceReason } from './types.ts'
export { WalletError } from './errors.ts'
export { SCHEMA_VERSION as WALLET_SQLITE_SCHEMA_VERSION, APPLICATION_ID as WALLET_SQLITE_APPLICATION_ID } from './store.ts'
export { toAmountMicros } from './types.ts'

/**
 * Format `balanceMicros` as a CNY string. UI consumer convenience — keeps the
 * locale / currency rules in one place rather than scattered across
 * renderers.
 * @param balanceMicros Integer CNY micros.
 * @returns A zh-CN CNY currency string.
 */
export function formatBalanceCny(balanceMicros: number): string {
  const cny = balanceMicros / 1_000_000
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(cny)
}
