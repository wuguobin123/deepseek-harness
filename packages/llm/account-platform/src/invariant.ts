import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
/** Companion plugin name. */
export const name = 'llm-account-platform-invariant'
/** Required invariant service. */
export const inject = ['invariants']
/** No runtime invariant: reservation relations are enforced by wallet transactions. */
const install: InvariantInstaller = () => {}
/** Register the package invariant companion. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register('@deepseek-ai/dsh-llm-account-platform', install))
