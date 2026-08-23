/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-ops-workbench-memories`.
 *
 * No runtime invariant: the package is a skeleton that reserves the
 * `ctx.memories` name. Memory integrity is owned by the OpenViking adapter
 * that lands with the first scenario that needs cross-session memory.
 *
 * @module @deepseek-ai/dsh-ops-workbench-memories/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-ops-workbench-memories'

/** Cordis companion plugin name. */
export const name = 'ops-workbench-memories-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this skeleton owns no observable state or event.
 * Memory integrity is owned by the OpenViking adapter.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
