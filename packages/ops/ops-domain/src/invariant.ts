/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-ops-domain`.
 *
 * No runtime invariant: the package is a skeleton that reserves the
 * `ctx.opsDomain` name. Domain integrity is owned by the Python peer
 * behind `@deepseek-ai/dsh-ops-subagent-python`; the TS surface has no
 * observable state until the first scenario lands.
 *
 * @module @deepseek-ai/dsh-ops-domain/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-ops-domain'

/** Cordis companion plugin name. */
export const name = 'ops-domain-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this skeleton owns no observable state or event.
 * Domain integrity is owned by the Python peer.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
