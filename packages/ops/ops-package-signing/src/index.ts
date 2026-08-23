/**
 * `@deepseek-ai/dsh-ops-package-signing` — sign and verify Skill/Subagent/MCP
 * bundles shipped through the ops product.
 *
 * The first signed bundle triggers the HMAC-SHA256 verifier. The signer
 * covers the bundle manifest together with a `PACKAGE.sig` artifact; the
 * verifier reads both, recomputes the HMAC over the canonical manifest, and
 * compares against the supplied signature before the bundle is admitted.
 *
 * Today the package ships a skeleton (no-op `apply`). The skeleton reserves
 * `ctx.opsPackageSigning` so a future Skill or Subagent provider can declare
 * signed bundles in its manifest without waiting for the verifier.
 *
 * @module @deepseek-ai/dsh-ops-package-signing
 */

import type { Context } from '@deepseek-ai/cordis'

/** Cordis plugin name used by `cordis.yml`. */
export const name = 'ops-package-signing'
/** Filesystem service required to read manifest and signature artifacts. */
export const inject: string[] = ['fs']
/** No configurable surface yet; config lands with the first signed bundle. */
export interface Config {}

/**
 * Phase 1 entry point. The plugin is intentionally a no-op until the
 * HMAC-SHA256 verifier lands with the first signed bundle.
 * @param ctx - Cordis context (currently unused; reserved for `ctx.opsPackageSigning`).
 */
export const apply = (_ctx: Context): void => {}
