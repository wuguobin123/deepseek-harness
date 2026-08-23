/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-ops-runtime`.
 *
 * No runtime invariant: the package reserves the runtime surface and ships
 * no agent preset today. Per the scenario接入 decision, specific
 * orchestrators (route_work, capability_runner, evidence_validator, OPDCA,
 * etc.) land only when a business scenario asks for them. When one does, its
 * agent-preset registration owns its own invariant.
 *
 * @module @deepseek-ai/dsh-ops-runtime/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-ops-runtime'

/** Cordis companion plugin name. */
export const name = 'ops-runtime-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the package ships no agent preset; each orchestrator
 * that lands here carries its own invariant.
 */
const install: InvariantInstaller = () => { /* no runtime state */ }

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
