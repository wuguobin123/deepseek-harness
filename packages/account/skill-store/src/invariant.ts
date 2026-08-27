/** Package-owned invariant companion. @module @deepseek-ai/dsh-account-skill-store/invariant */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-account-skill-store'
/** Cordis plugin name. */
export const name = 'account-skill-store-invariant'
/** Required service dependencies. */
export const inject = ['invariants']
/**
 * No runtime invariant: each write is an atomic directory replacement and
 * discovery validates the durable files when it reads them.
 */
const install: InvariantInstaller = () => {}
/** Register this package with the runtime invariant registry. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
