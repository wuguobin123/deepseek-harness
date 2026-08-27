/**
 * Empty invariant companion for `@deepseek-ai/dsh-account-wallet`.
 *
 * The wallet provider's externally observable relations are ledger writes
 * and balance reads — discrete events, not a continuous in-process relation
 * a companion could compare without creating the very fact it would check.
 * Empty installers with the standard reason text satisfy
 * `verify-package-invariants`.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-account-wallet'

/** Cordis companion plugin name. */
export const name = 'account-wallet-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the wallet provider's external relations are
 * discrete writes/reads on `wallets` + `wallet_ledger`, observable through
 * the wire layer rather than a continuous in-process event stream.
 */
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
