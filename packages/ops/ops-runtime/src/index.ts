/**
 * `@deepseek-ai/dsh-ops-runtime` — agent preset container for the ops product.
 *
 * Specific orchestrators (route_work, capability_runner, evidence_validator,
 * OPDCA planner, etc.) land as separate subagent providers together with
 * their Python peer under `packages/ops/` only when a scenario explicitly
 * requires them. This package reserves the runtime surface so consumers can
 * reason about "where an ops business Subagent comes from" before the first
 * orchestrator ships.
 *
 * Per the scenario接入 decision, OPDCA is **not** in this plan; it lands
 * when a concrete business scenario asks for it.
 *
 * @module @deepseek-ai/dsh-ops-runtime
 */

import type { Context } from '@deepseek-ai/cordis'

/** Cordis plugin name used by `cordis.yml`. */
export const name = 'ops-runtime'
/** No injected services; agent presets are mounted by sibling rows. */
export const inject: string[] = []
/** Empty until the first orchestrator scenario lands. */
export interface Config {}

/**
 * Phase 1 entry point. The plugin is intentionally a no-op until a scenario
 * declares a business Subagent preset that lives here.
 * @param ctx - Cordis context (currently unused; reserved for runtime registration).
 */
export const apply = (_ctx: Context): void => {}
