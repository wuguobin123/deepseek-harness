/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-account-identity`.
 *
 * The provider is observable only through cross-process HTTP / IPC surfaces
 * (the wire methods, the trust fence, the desktop `Authorization` header);
 * there is no in-process event stream a companion can observe without a
 * private mirror of the source of truth. The companion is therefore empty,
 * and the empty-installers rationale is recorded here per
 * `verify-package-invariants`.
 *
 * @module @deepseek-ai/dsh-account-identity/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-account-identity'

/** Cordis companion plugin name. */
export const name = 'account-identity-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the identity provider's external relations are the
 * wire methods and the trust fence, neither of which is a continuous
 * in-process relation a companion can compare without creating the very fact
 * it would check.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
