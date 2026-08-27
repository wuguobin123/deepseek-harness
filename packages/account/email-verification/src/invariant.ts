/**
 * Empty invariant companion for `@deepseek-ai/dsh-account-email-verification`.
 *
 * The provider's externally observable relations (requestCode / verifyCode
 * outcomes, wire methods, sender logs) are discrete events, not a continuous
 * stream a companion could compare without creating the very fact it would
 * check. Empty installers with the standard reason text satisfy
 * `verify-package-invariants`.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-account-email-verification'

/** Cordis companion plugin name. */
export const name = 'account-email-verification-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the provider's external relations are the wire
 * methods and the sender (whose transport is a side effect), neither of which
 * is a continuous in-process relation.
 */
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
