/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-ops-approval-policy`.
 *
 * No runtime invariant: the package is a skeleton that reserves the four
 * policy fields (`risk`, `executionVersion`, `validForSeconds`, `argumentsHash`)
 * on top of `ctx.userApproval`. The resolver that consumes them lands with the
 * first scenario; until then the package owns no observable state or event.
 *
 * @module @deepseek-ai/dsh-ops-approval-policy/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-ops-approval-policy'

/** Cordis companion plugin name. */
export const name = 'ops-approval-policy-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this skeleton owns no observable state or event.
 * Approval-seam integrity is owned by `@deepseek-ai/dsh-interaction-user-approval`.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
