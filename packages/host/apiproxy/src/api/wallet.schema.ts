/**
 * account.wallet.* zod schemas (names derived from map keys).
 *
 * The session token and user id ride the wire as opaque base64url strings;
 * the schema accepts any non-empty string and the host implementation
 * re-brands to the identity-package brand at the call site. Length is
 * bounded only by the brand's minimum (1 char) so the schema does not
 * duplicate the identity-package generator.
 *
 * The `amountMicros` schema stays an integer; `MAX_DELTA_MICROS = 1e9` is
 * enforced at the host seam, not at the schema (a zod range stops the
 * 500-class failure but the seam's own assertion names the violation
 * with its reason text).
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import type { LedgerEntry, WalletView } from './wallet.ts'

/** Wire-side opaque id brand cast (UserId). */
const opaqueIdSchema = z.string().min(1)

/** Closed union of ledger reasons the wire accepts. */
const reasonSchema = z.enum(['welcome', 'daily-refresh', 'topup', 'debit', 'set-quota', 'refund'])

/** Plain integer micros, capped at the seam's MAX_DELTA_MICROS (1e9) to fail fast. */
const amountMicrosSchema = z.number().int().min(-1_000_000_000).max(1_000_000_000)

/** Idempotency key for credit/debit/refreshDaily: 1..64 chars per the seam. */
const idempotencyKeySchema = z.string().min(1).max(64).optional()

/** account.wallet.get request payload. */
export const accountWalletGetRequestSchema = z.object({
  userId: opaqueIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'account.wallet.get'>>>

/** account.wallet.get response value. */
export const accountWalletGetValueSchema = z.object({
  userId: opaqueIdSchema,
  balanceMicros: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
}) satisfies z.ZodType<Wire<ResponseValue<'account.wallet.get'>>>

/** account.wallet.credit request payload. */
export const accountWalletCreditRequestSchema = z.object({
  userId: opaqueIdSchema,
  amountMicros: z.number().int().positive(),
  reason: reasonSchema,
  idempotencyKey: idempotencyKeySchema,
}) satisfies z.ZodType<Wire<RequestPayload<'account.wallet.credit'>>>

/** account.wallet.debit request payload. */
export const accountWalletDebitRequestSchema = z.object({
  userId: opaqueIdSchema,
  amountMicros: z.number().int().positive(),
  reason: reasonSchema,
  idempotencyKey: idempotencyKeySchema,
}) satisfies z.ZodType<Wire<RequestPayload<'account.wallet.debit'>>>

/** account.wallet.setQuota request payload. */
export const accountWalletSetQuotaRequestSchema = z.object({
  userId: opaqueIdSchema,
  balanceMicros: amountMicrosSchema,
  reason: reasonSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'account.wallet.setQuota'>>>

/** account.wallet.refreshDaily request payload. */
export const accountWalletRefreshDailyRequestSchema = z.object({
  userId: opaqueIdSchema,
  idempotencyKey: z.string().min(1).max(64),
}) satisfies z.ZodType<Wire<RequestPayload<'account.wallet.refreshDaily'>>>

/** account.wallet.grantWelcomeBonus request payload. */
export const accountWalletGrantWelcomeBonusRequestSchema = z.object({
  userId: opaqueIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'account.wallet.grantWelcomeBonus'>>>

/** account.wallet.listLedger request payload. */
export const accountWalletListLedgerRequestSchema = z.object({
  userId: opaqueIdSchema,
  limit: z.number().int().positive().max(200).optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'account.wallet.listLedger'>>>

/** Single ledger entry projection. */
const ledgerEntrySchema: z.ZodType<Wire<LedgerEntry>> = z.object({
  id: z.number().int().positive(),
  userId: opaqueIdSchema,
  deltaMicros: z.number().int(),
  reason: reasonSchema,
  balanceAfter: z.number().int().nonnegative(),
  createdAt: z.number().int().positive(),
  idempotencyKey: z.string().nullable(),
})

/** account.wallet.listLedger response value. */
export const accountWalletListLedgerValueSchema = z.object({
  items: z.array(ledgerEntrySchema),
}) satisfies z.ZodType<Wire<ResponseValue<'account.wallet.listLedger'>>>

/**
 * Shared value shape used by every account.wallet.* mutation: `get`,
 * `credit`, `debit`, `setQuota`, `refreshDaily`, `grantWelcomeBonus`.
 * The seam's own `WalletView` rides the wire as exactly this object.
 */
const walletViewSchema: z.ZodType<Wire<WalletView>> = z.object({
  userId: opaqueIdSchema,
  balanceMicros: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
})

export const accountWalletCreditValueSchema = walletViewSchema satisfies z.ZodType<Wire<ResponseValue<'account.wallet.credit'>>>
export const accountWalletDebitValueSchema = walletViewSchema satisfies z.ZodType<Wire<ResponseValue<'account.wallet.debit'>>>
export const accountWalletSetQuotaValueSchema = walletViewSchema satisfies z.ZodType<Wire<ResponseValue<'account.wallet.setQuota'>>>
export const accountWalletRefreshDailyValueSchema = walletViewSchema satisfies z.ZodType<Wire<ResponseValue<'account.wallet.refreshDaily'>>>
export const accountWalletGrantWelcomeBonusValueSchema = walletViewSchema satisfies z.ZodType<Wire<ResponseValue<'account.wallet.grantWelcomeBonus'>>>
