/**
 * Static bundle invariant companion.
 * @module @deepseek-ai/dsh-xiaowei-local/invariant
 */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-xiaowei-local'

/** Cordis plugin name. */
export const name = 'xiaowei-local-bundle-invariant'

/** Required service dependencies. */
export const inject = ['invariants']

/** Every runtime relation is checked by the capability package that owns it. */
const install: InvariantInstaller = () => {}

/**
 * Register this bundle with the runtime invariant registry.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
