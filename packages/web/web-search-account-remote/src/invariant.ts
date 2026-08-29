import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
/** Package invariant companion; the IPC provider has no registry relation beyond ctx.web registration. */
const PACKAGE_NAME = '@deepseek-ai/dsh-web-search-account-remote'
/** Cordis companion plugin name. */
export const name = 'web-search-account-remote-invariant'
/** Service required before reserving package invariant ownership. */
export const inject = ['invariants']
const install: InvariantInstaller = () => {}
/** Register the package invariant companion. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
