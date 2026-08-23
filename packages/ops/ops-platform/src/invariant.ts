/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-ops-platform`.
 *
 * No runtime invariant: the package is a skeleton that reserves the
 * `ctx.opsPlatform` name. Capability integrity is owned by the first scenario
 * that declares a manifest; the TS surface has no observable state until the
 * risk taxonomy (`R1`/`R2`/`R3`) and capability entries land.
 *
 * @module @deepseek-ai/dsh-ops-platform/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-ops-platform'

/** Cordis companion plugin name. */
export const name = 'ops-platform-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this skeleton owns no observable state or event.
 * Capability integrity is owned by the first scenario that declares a manifest.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
