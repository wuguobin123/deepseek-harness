/**
 * Empty invariant companion for `@deepseek-ai/dsh-user-context`.
 *
 * The user-context provider's externally observable relations are discrete
 * writes / reads on `user_context`; the seam has no continuous in-process
 * event stream a companion could compare without creating the very fact it
 * would check. Empty installers with the standard reason text satisfy
 * `verify-package-invariants`.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-user-context'

/** Cordis companion plugin name. */
export const name = 'user-context-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the user-context provider's external relations are
 * discrete writes/reads on the `user_context` table, observable through the
 * wire layer rather than a continuous in-process event stream.
 */
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
