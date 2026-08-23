/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-ops-workbench-conversations`.
 *
 * No runtime invariant: the package is a skeleton that reserves the
 * `ctx.conversations` projection. Conversation integrity is owned by the
 * scenario that first needs multi-tenant chat history; the TS surface has no
 * observable state until that scenario lands.
 *
 * @module @deepseek-ai/dsh-ops-workbench-conversations/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-ops-workbench-conversations'

/** Cordis companion plugin name. */
export const name = 'ops-workbench-conversations-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this skeleton owns no observable state or event.
 * Conversation integrity is owned by the first scenario that needs it.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
