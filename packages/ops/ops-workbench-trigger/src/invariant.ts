/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-ops-workbench-trigger`.
 *
 * No runtime invariant: the package is a skeleton that reserves the
 * `ctx.triggers` name. Trigger integrity is owned by the global trigger
 * implementation that lands with the first scenario that needs cross-session
 * reminders.
 *
 * @module @deepseek-ai/dsh-ops-workbench-trigger/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-ops-workbench-trigger'

/** Cordis companion plugin name. */
export const name = 'ops-workbench-trigger-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this skeleton owns no observable state or event.
 * Trigger integrity is owned by the global trigger implementation.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
