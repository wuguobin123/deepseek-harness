/** Invariant companion for the embedding capability. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
const PACKAGE_NAME = '@deepseek-ai/dsh-embedding'
/** Companion plugin name. */
export const name = 'embedding-invariant'
/** Required invariant service. */
export const inject = ['invariants']
const install: InvariantInstaller = () => {}
/** Register the companion invariant. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
