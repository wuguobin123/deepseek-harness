/** Package-owned invariant companion. @module @deepseek-ai/dsh-tool-skill-install/invariant */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-skill-install'
/** Cordis plugin name. */
export const name = 'tool-skill-install-invariant'
/** Required service dependencies. */
export const inject = ['invariants']
/**
 * No runtime invariant: the tool owns no durable state after the approved
 * account skill-store write and registry refresh complete.
 */
const install: InvariantInstaller = () => {}
/** Register this package with the runtime invariant registry. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
