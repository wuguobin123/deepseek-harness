/**
 * Wallet-specific error codes. The wire layer (`packages/host/apiproxy/src/api/wallet.ts`)
 * maps these to RPC error codes so the renderer / desktop can branch without
 * reading the message string.
 *
 * `INSUFFICIENT_BALANCE` is the only semantic code; everything else is
 * schema-rejected (`BAD_REQUEST`) or unavailable (`WALLET_UNAVAILABLE`).
 */

import type { InsufficientBalanceReason } from './types.ts'

/** Wire-level error codes returned by `account.wallet.*` methods. */
export type WalletErrorCode =
  | 'BAD_REQUEST'
  | 'INSUFFICIENT_BALANCE'
  | 'DUPLICATE_REFRESH'
  | 'RESERVATION_CONFLICT'
  | 'RESERVATION_NOT_FOUND'
  | 'RESERVATION_ALREADY_SETTLED'
  | 'RESERVATION_ALREADY_CANCELLED'
  | 'RESERVATION_ACTUAL_EXCEEDS_RESERVED'
  | 'WALLET_UNAVAILABLE'

/** Thrown by the local provider; carries a stable wire code + message. */
export class WalletError extends Error {
  /** Stable machine-readable failure code. */
  readonly code: WalletErrorCode
  /** Optional structured detail surfaced alongside the error. */
  readonly detail: InsufficientBalanceReason | undefined
  override readonly cause?: unknown

  constructor(code: WalletErrorCode, message: string, options?: { detail?: InsufficientBalanceReason; cause?: unknown }) {
    super(message)
    this.name = 'WalletError'
    this.code = code
    if (options?.detail !== undefined) this.detail = options.detail
    if (options?.cause !== undefined) this.cause = options.cause
  }
}

/** Maximum credit/debit amount in micros. 1e9 micros = 1_000 CNY per call. */
export const MAX_DELTA_MICROS = 1_000_000_000
/** Maximum setQuota balance. 1e10 micros = 10_000 CNY. */
export const MAX_BALANCE_MICROS = 10_000_000_000

/**
 * Validate that `value` is a safe integer in `[-(MAX), +(MAX)]`. Empty values
 * throw `BAD_REQUEST`; callers wrap their own domain reason around it.
 * @param value Candidate amount.
 * @param field Field name for diagnostics.
 * @param max Inclusive absolute limit.
 * @returns Narrows the value to a number.
 */
export function assertAmount(value: unknown, field: string, max: number = MAX_DELTA_MICROS): asserts value is number {
  if (typeof value !== 'number') throw new WalletError('BAD_REQUEST', `${field} must be a number`)
  if (!Number.isSafeInteger(value)) throw new WalletError('BAD_REQUEST', `${field} must be a safe integer`)
  if (value < -max || value > max) throw new WalletError('BAD_REQUEST', `${field} must be within ±${max} micros`)
}

/**
 * Validate the length of an idempotency key. We accept any non-empty string up
 * to 64 bytes — long enough for `YYYY-MM-DD` plus a per-user suffix, short
 * enough to keep the unique index narrow.
 * @param key Candidate key.
 * @returns Narrows the value to a valid string.
 */
export function assertIdempotencyKey(key: unknown): asserts key is string {
  if (typeof key !== 'string') throw new WalletError('BAD_REQUEST', 'idempotencyKey must be a string')
  if (key.length === 0 || key.length > 64) {
    throw new WalletError('BAD_REQUEST', 'idempotencyKey length must be 1..64')
  }
}

/** Reasons accepted at the wire layer. The provider accepts a wider set. */
const WIRE_REASONS = new Set([
  'welcome',
  'daily-refresh',
  'topup',
  'debit',
  'set-quota',
  'refund',
  'model-usage',
] as const)

/** Validate one ledger reason.
 * @param reason Candidate reason.
 * @returns Narrows the value to a supported reason.
 */
export function assertReason(reason: unknown): asserts reason is import('./types.ts').LedgerReason {
  if (typeof reason !== 'string' || !WIRE_REASONS.has(reason as import('./types.ts').LedgerReason)) {
    throw new WalletError('BAD_REQUEST', `reason must be one of: ${[...WIRE_REASONS].join(', ')}`)
  }
}
