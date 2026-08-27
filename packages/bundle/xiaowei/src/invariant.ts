/**
 * `@deepseek-ai/dsh-xiaowei/invariant` — empty invariant registration.
 *
 * The xiaowei profile mounts the full base layer plus the
 * account/wallet/model-keys/artifact capability seams. Every owned
 * invariant lives in its declaring package; this package owns the patch
 * composition only.
 *
 * @module @deepseek-ai/dsh-xiaowei/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-xiaowei'

/** Cordis plugin name used by `cordis.yml`. */
export const name = 'xiaowei-invariant'

/** Required service. */
export const inject = ['invariants']

/**
 * No runtime invariant: the bundle owns profile composition only; each mounted
 * capability registers and checks its authoritative relations in its package.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this bundle's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
