/**
 * `@deepseek-ai/dsh-ops-platform` — Phase 1 skeleton.
 *
 * Capability Registry + risk taxonomy for the ops product group. The eventual
 * service exposes `ctx.opsPlatform` so the harness and the ops Subagents can
 * enumerate registered capabilities (Skill, MCP, Subagent) with risk levels,
 * validate that a requested execution matches a granted approval (risk level
 * + execution_version + arguments_hash), and resolve the planner hints
 * (`after`, `requires`, `step_id`) that downstream orchestrators consume.
 *
 * The risk taxonomy is `R1` (read-only, low blast radius), `R2` (side effects
 * are reversible within the agent scope), and `R3` (irreversible or
 * out-of-scope effects that require an explicit approval). The first capability
 * that declares a manifest lands together with the taxonomy it belongs to.
 *
 * Today the skeleton registers no service; the schema and risk taxonomy land
 * when the first scenario declares a capability manifest. The skeleton only
 * reserves the `ctx.opsPlatform` surface so later packages can compile against
 * the contract.
 *
 * @module @deepseek-ai/dsh-ops-platform
 */

import type { Context } from '@deepseek-ai/cordis'

/** Cordis plugin name used by `cordis.yml`. */
export const name = 'ops-platform'
/** Services this plugin requires; declared for the registry that consumes provider descriptors. */
export const inject: string[] = ['subagents']
/** No configurable surface yet; config lands with the first capability manifest. */
export interface Config {}

/**
 * Phase 1 entry point. The plugin is intentionally a no-op until a scenario
 * declares a capability manifest.
 * @param ctx - Cordis context (currently unused; reserved for `ctx.opsPlatform`).
 */
export const apply = (_ctx: Context): void => {}
