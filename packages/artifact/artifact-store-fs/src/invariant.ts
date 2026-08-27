/** Package-owned invariant companion for `@deepseek-ai/dsh-artifact-store-fs`. @module @deepseek-ai/dsh-artifact-store-fs/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-artifact-store-fs'
/** Cordis companion plugin name. */
export const name = 'artifact-store-fs-invariant'
/** Services required before package ownership can be reserved. */
export const inject = ['invariants', 'artifactRegistry']
/** No runtime invariant: immutable writes and verified reads are enforced directly at the backend boundary. */
const install: InvariantInstaller = () => {}
/**
 * Register the package invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
