/** Package-owned invariant companion. @module @deepseek-ai/dsh-account-plugin-factory/invariant */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-account-plugin-factory'
/** Cordis plugin name. */
export const name = 'account-plugin-factory-invariant'
/** Required service dependencies. */
export const inject = ['invariants']
/**
 * No runtime invariant: the authoritative relation is the durable account row
 * plus the session selection event, both validated at their read boundaries.
 */
const install: InvariantInstaller = () => {}
/** Register this package with the runtime invariant registry. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
