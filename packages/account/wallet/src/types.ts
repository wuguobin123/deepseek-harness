/**
 * Public types for the wallet seam.
 *
 * Unit: all monetary values are integer micros (1_000_000 micros = 1.00 CNY).
 * The wire shape stays in micros; the UI layer formats them through
 * `Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' })`.
 *
 * @module @deepseek-ai/dsh-account-wallet/types
 */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { UserId } from '@deepseek-ai/dsh-account-identity'

/** Re-export the cross-boundary brand so consumers can wire a single import. */
export type { UserId } from '@deepseek-ai/dsh-account-identity'

/** A signed integer measured in micros (1 CNY = 1_000_000 micros). */
export type AmountMicros = Branded<'AmountMicros'>

/** Brand a boundary-validated monetary amount.
 * @param value Validated integer micros.
 * @returns The branded amount.
 */
export function toAmountMicros(value: number): AmountMicros {
  return value as unknown as AmountMicros
}

/** Public view returned by `get` / `credit` / `debit` / `setQuota`. */
export interface WalletView {
  readonly userId: UserId
  readonly balanceMicros: number
  readonly updatedAt: number
}

/** A durable hold that reduces spendable balance without changing balanceMicros. */
export interface WalletReservation {
  readonly userId: UserId
  readonly reservationId: string
  readonly reservedMicros: number
  readonly createdAt: number
  readonly expiresAt: number
}

/** Result of settling a reservation; the ledger delta is `-actualMicros`. */
export interface WalletSettlement {
  readonly userId: UserId
  readonly reservationId: string
  readonly reservedMicros: number
  readonly actualMicros: number
  readonly refundedMicros: number
  readonly balanceMicros: number
  readonly updatedAt: number
  readonly ledgerId: number
}

/** Reason codes accepted by `credit` / `debit` / `setQuota` / `refreshDaily`. */
export type LedgerReason =
  | 'welcome'
  | 'daily-refresh'
  | 'topup'
  | 'debit'
  | 'set-quota'
  | 'refund'
  | 'model-usage'

/** A single ledger entry, returned by `listLedger`. */
export interface LedgerEntry {
  readonly id: number
  readonly userId: UserId
  readonly deltaMicros: number
  readonly reason: LedgerReason
  readonly balanceAfter: number
  readonly createdAt: number
  readonly idempotencyKey: string | null
}

/** Reason for an `INSUFFICIENT_BALANCE` throw — `null` when the row is absent. */
export interface InsufficientBalanceReason {
  readonly userId: UserId
  readonly balanceMicros: number
  readonly attemptedMicros: number
}
