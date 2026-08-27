/**
 * Empty invariant companion for `@deepseek-ai/dsh-account-model-keys`.
 *
 * The provider's externally observable relations are `provision` / `list` /
 * `revoke` outcomes — discrete events, not a continuous in-process relation
 * a companion could compare without creating the very fact it would check.
 * Empty installers with the standard reason text satisfy
 * `verify-package-invariants`.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-account-model-keys'

/** Cordis companion plugin name. */
export const name = 'account-model-keys-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the user-model-keys provider's external relations
 * are discrete writes/reads on `user_model_keys`, observable through the
 * wire layer rather than a continuous in-process event stream.
 */
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
