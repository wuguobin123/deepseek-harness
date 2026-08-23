/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-ops-skill`.
 *
 * No runtime invariant: the Skill registry owns registration uniqueness and
 * lifecycle checks; this provider contributes one bundled Skill catalog and
 * stays otherwise passive. Malformed entries drop with a warning from the
 * provider's `list()` path; the registry surfaces the warning.
 *
 * @module @deepseek-ai/dsh-ops-skill/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-ops-skill'

/** Cordis companion plugin name. */
export const name = 'ops-skill-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the Skill registry owns uniqueness and lifecycle;
 * this provider is a bundled scanner.
 */
const install: InvariantInstaller = () => { /* no runtime state */ }

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
