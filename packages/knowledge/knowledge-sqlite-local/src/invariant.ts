/** Invariant companion for the local knowledge provider. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

/** Companion plugin name. */
export const name = 'knowledge-sqlite-local-invariant'
/** Invariant registry dependency. */
export const inject = ['invariants']
const install: InvariantInstaller = () => {}
/** Register the provider invariant companion. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register('@deepseek-ai/dsh-knowledge-sqlite-local', install))
