/**
 * `@deepseek-ai/dsh-ops/invariant` — empty invariant registration.
 *
 * The ops profile mounts the full base layer plus every ops-* plugin. Every
 * owned invariant lives in its declaring package; this package owns the patch
 * composition only.
 *
 * @module @deepseek-ai/dsh-ops/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-invariants'

/** Cordis plugin name used by `cordis.yml`. */
export const name = 'ops-invariant'

/** Required service. */
export const inject = ['invariants']

/** No runtime invariant; ops-* packages own theirs. */
export interface Config {}

/**
 * No-op install.
 * @param _ctx - Cordis context carrying the invariant registry (currently unused).
 */
export function install(_ctx: Context): void {}