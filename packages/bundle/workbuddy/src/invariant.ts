/**
 * `@deepseek-ai/dsh-workbuddy/invariant` — empty invariant registration.
 *
 * The workbuddy profile mounts the full base layer plus the
 * account/wallet/model-keys/artifact capability seams. Every owned
 * invariant lives in its declaring package; this package owns the patch
 * composition only.
 *
 * @module @deepseek-ai/dsh-workbuddy/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-invariants'

/** Cordis plugin name used by `cordis.yml`. */
export const name = 'workbuddy-invariant'

/** Required service. */
export const inject = ['invariants']

/** No runtime invariant; account/wallet/model-keys/artifact packages own theirs. */
export interface Config {}

/**
 * No-op install.
 * @param _ctx - Cordis context carrying the invariant registry (currently unused).
 */
export function install(_ctx: Context): void {}
