/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-ops-workbench-anomaly`.
 *
 * No runtime invariant: the package is a skeleton that reserves the
 * `ctx.anomalies` name. Anomaly detectors land with the first scenario that
 * needs them; until then the surface has no observable state or event to
 * check.
 *
 * @module @deepseek-ai/dsh-ops-workbench-anomaly/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-ops-workbench-anomaly'

/** Cordis companion plugin name. */
export const name = 'ops-workbench-anomaly-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this skeleton owns no observable state or event.
 * Anomaly integrity is checked by the detectors that land with the first
 * scenario that needs them.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
