/** Package-owned invariant companion for `@deepseek-ai/dsh-tool-knowledge`. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-knowledge'
export const name = 'tool-knowledge-invariant'
export const inject = ['invariants']
const install: InvariantInstaller = () => {}
/** Register the stateless package invariant companion. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
