/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-ops-loop-guard`.
 *
 * No runtime invariant: the package is a skeleton that reserves the five-class
 * loop-detection surface atop `@deepseek-ai/dsh-guard-repeat-tool-reminder`.
 * Detection integrity is owned by the parent reminder plugin and the agent
 * loop; this surface has no observable state until the first detector lands.
 *
 * @module @deepseek-ai/dsh-ops-loop-guard/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-ops-loop-guard'

/** Cordis companion plugin name. */
export const name = 'ops-loop-guard-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this skeleton owns no observable state or event.
 * Loop-detection integrity is owned by the parent reminder plugin.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
