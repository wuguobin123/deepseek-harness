/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-ops-package-signing`.
 *
 * No runtime invariant: the package is a skeleton that reserves the
 * `ctx.opsPackageSigning` name. Signing integrity is owned by the verifier
 * that lands with the first signed bundle; the TS surface has no observable
 * state until that arrives.
 *
 * @module @deepseek-ai/dsh-ops-package-signing/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-ops-package-signing'

/** Cordis companion plugin name. */
export const name = 'ops-package-signing-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this skeleton owns no observable state or event.
 * Signing integrity is owned by the future HMAC-SHA256 verifier.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
