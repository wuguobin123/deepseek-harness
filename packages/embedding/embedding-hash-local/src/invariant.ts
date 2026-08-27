/** Invariant companion for the offline hash embedding provider. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
const PACKAGE_NAME = '@deepseek-ai/dsh-embedding-hash-local'
/** Companion plugin name. */
export const name = 'embedding-hash-local-invariant'
/** Required invariant service. */
export const inject = ['invariants']
const install: InvariantInstaller = () => {}
/** Register the companion invariant. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
