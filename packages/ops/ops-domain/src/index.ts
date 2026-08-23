/**
 * `@deepseek-ai/dsh-ops-domain` — Phase 1 skeleton.
 *
 * The actual business domain models (Pydantic types for objectives, plans,
 * work items, diagnostics, outbound calls, QA, products, reports, approvals,
 * audit) live in the Python peer behind `@deepseek-ai/dsh-ops-subagent-python`.
 * This package reserves the TS-side surface (`ctx.opsDomain`) so a future TS
 * consumer can read snapshot types or attach projection units without waiting
 * for a Python round-trip.
 *
 * The skeleton registers no service today; scenario接入 happens per domain
 * shape, not as a bulk migration. The first scenario that needs a TS-side
 * mirror lands here together with its Python peer and a contract test.
 *
 * @module @deepseek-ai/dsh-ops-domain
 */

import type { Context } from '@deepseek-ai/cordis'

/** Cordis plugin name used by `cordis.yml`. */
export const name = 'ops-domain'
/** Services this plugin requires; declared for future service registration. */
export const inject: string[] = []
/** No configurable surface yet; config lands with the first TS-side scenario. */
export interface Config {}

/**
 * Phase 1 entry point. The plugin is intentionally a no-op until a scenario
 * declares a TS-side domain mirror.
 * @param ctx - Cordis context (currently unused; reserved for `ctx.opsDomain`).
 */
export const apply = (_ctx: Context): void => {}
