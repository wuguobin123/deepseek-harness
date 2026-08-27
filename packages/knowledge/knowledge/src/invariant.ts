/** Package-owned invariant companion for `@deepseek-ai/dsh-knowledge`. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-knowledge'
/** Cordis companion plugin name. */
export const name = 'knowledge-invariant'
/** Required service. */
export const inject = ['invariants']
const install: InvariantInstaller = () => {}
/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
