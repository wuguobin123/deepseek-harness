/**
 * Wallet domain contract — wire projection of `ctx.wallet` for the multi-user
 * workbuddy backend.
 *
 * The seam is one Service Definition (`WalletService` in
 * `@deepseek-ai/dsh-account-wallet`) plus six unary methods. Three of them
 * are loopback-only on the deployment (credit / setQuota / refreshDaily) —
 * the wire-layer fence restricts callers — and two are loopback OR bearer
 * (get, listLedger) so the signed-in user can read their own balance and
 * recent ledger history.
 *
 * `grantWelcomeBonus` exists to keep the signup trigger chain declarative;
 * it is loopback-only, called once by `account.signup` after identity
 * creation.
 *
 * Branded `UserId` rides the wire as a string carrying the same opaque
 * brand string the identity package uses; the api/ layer is browser-safe
 * and cannot import the brand primitive, so the cast happens at the host
 * seam call site.
 *
 * `AmountMicros` is plain number on the wire: the seam itself owns a
 * `Branded<'AmountMicros'>` for in-process discipline, but the JSON
 * transport is integer micros — one CNY equals one million micros. UI
 * layers format through `Intl.NumberFormat`.
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { RpcRequest, RpcResponse } from './rpc.ts'

/** Wire-side opaque user id brand. Mirrors `UserId` from dsh-account-identity. */
export type UserId = string

/** Wire-side opaque reason for one ledger row. Closed union. */
export type WalletLedgerReason =
  | 'welcome'
  | 'daily-refresh'
  | 'topup'
  | 'debit'
  | 'set-quota'
  | 'refund'

/** Signed integer micros (1 CNY = 1_000_000 micros). The wire carries plain numbers. */
export type AmountMicros = Branded<'AmountMicros'>

/** Reason for an `insufficient-balance` refusal — surfaced alongside the error. */
export interface InsufficientBalanceReason {
  readonly userId: UserId
  readonly balanceMicros: number
  readonly attemptedMicros: number
}

/** Single wallet view carried by every read/write response. */
export interface WalletView {
  userId: UserId
  balanceMicros: number
  /** Absolute unix-millisecond timestamp of the last ledger write. */
  updatedAt: number
}

/** One row from the `wallet_ledger` table. */
export interface LedgerEntry {
  id: number
  userId: UserId
  /** Signed integer micros: positive for credits, negative for debits. */
  deltaMicros: number
  reason: WalletLedgerReason
  /** The wallet's balance after this row applied. */
  balanceAfter: number
  /** Absolute unix-millisecond creation time. */
  createdAt: number
  /** Idempotency key when the call carried one; null otherwise. */
  idempotencyKey: string | null
}

/** Wallet-domain unary methods (the map keys account.wallet.* of RpcMethodMap). */
export interface WalletApi {
  /**
   * Fetch the current wallet view for one user. Returns a zero-balance view
   * when the user has no row yet (the bootstrap happens on first credit).
   * Loopback OR bearer: a signed-in user may read their own balance.
   */
  get(request: RpcRequest<{ userId: UserId }>): Promise<RpcResponse<WalletView>>

  /**
   * Add `amountMicros` to the balance and append one ledger row. Loopback-only;
   * the fence restricts this to admin scripts (topup flow).
   * @throws `insufficient-balance` is unreachable (credit never debits).
   * @throws `bad-request` on schema-rejected input or a non-positive amount.
   */
  credit(request: RpcRequest<{
    userId: UserId
    amountMicros: number
    reason: WalletLedgerReason
    /** Idempotency key for retry-safe calls (1..64 chars). */
    idempotencyKey?: string
  }>): Promise<RpcResponse<WalletView>>

  /**
   * Subtract `amountMicros` from the balance and append one ledger row.
   * Loopback-only: the harness, not the client, decides when to debit.
   * @throws `insufficient-balance` when the balance would go negative.
   * @throws `bad-request` on schema-rejected input.
   */
  debit(request: RpcRequest<{
    userId: UserId
    amountMicros: number
    reason: WalletLedgerReason
    idempotencyKey?: string
  }>): Promise<RpcResponse<WalletView>>

  /**
   * Force the balance to `balanceMicros` and append a `set-quota` ledger row.
   * Admin-privileged; loopback-only.
   */
  setQuota(request: RpcRequest<{
    userId: UserId
    balanceMicros: number
    reason: WalletLedgerReason
  }>): Promise<RpcResponse<WalletView>>

  /**
   * Apply the configured daily-refresh amount once. Cron-style idempotency:
   * a second call with the same `idempotencyKey` returns the prior balance
   * without applying a second delta. Loopback-only.
   */
  refreshDaily(request: RpcRequest<{
    userId: UserId
    /** `YYYY-MM-DD` per-user — unique by `(user_id, idempotency_key)` index. */
    idempotencyKey: string
  }>): Promise<RpcResponse<WalletView>>

  /**
   * Apply the configured welcome bonus exactly once. Convenience for
   * `credit(reason: 'welcome', idempotencyKey: 'welcome:<userId>')`.
   * Loopback-only — the signup trigger chain calls it.
   */
  grantWelcomeBonus(request: RpcRequest<{ userId: UserId }>): Promise<RpcResponse<WalletView>>

  /**
   * Return recent ledger entries, newest first. Loopback OR bearer — a
   * signed-in user may read their own history.
   */
  listLedger(request: RpcRequest<{
    userId: UserId
    limit?: number
  }>): Promise<RpcResponse<{ items: LedgerEntry[] }>>
}
