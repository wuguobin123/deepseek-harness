/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-max-token-continuation`.
 * @module @deepseek-ai/dsh-max-token-continuation/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-max-token-continuation'

/** Cordis companion plugin name. */
export const name = 'max-token-continuation-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the continuation relation spans the authoritative
 * session event log and the inbox projection, so this package verifies it in
 * focused scheduling tests rather than registering a partial event invariant.
 */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
