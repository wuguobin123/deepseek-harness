/**
 * Invariant companion for the local Skill installer.
 * @module @deepseek-ai/dsh-tool-skill-install-local/invariant
 */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-skill-install-local'

/** Cordis plugin name. */
export const name = 'tool-skill-install-local-invariant'

/** Required service dependencies. */
export const inject = ['invariants']

/** The tool owns no live relation after an approved atomic file publication completes. */
const install: InvariantInstaller = () => {}

/**
 * Register this package with the runtime invariant registry.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
