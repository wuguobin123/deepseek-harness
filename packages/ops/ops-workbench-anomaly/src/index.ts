/**
 * `@deepseek-ai/dsh-ops-workbench-anomaly` — Phase 1 skeleton.
 *
 * The anomaly detection surface for the ops workbench detects session and turn
 * anomalies and exposes them through `ctx.anomalies`. Today the package ships
 * a skeleton that reserves the service name; detectors land together with the
 * first scenario that needs anomaly surfacing.
 *
 * @module @deepseek-ai/dsh-ops-workbench-anomaly
 */

import type { Context } from '@deepseek-ai/cordis'

/** Cordis plugin name used by `cordis.yml`. */
export const name = 'ops-workbench-anomaly'
/** Session service required by the anomaly detectors that land with the first scenario. */
export const inject: string[] = ['sessions']
/** No configurable surface yet; config lands with the first scenario that needs anomaly surfacing. */
export interface Config {}

/**
 * Phase 1 entry point. The plugin is intentionally a no-op until a scenario
 * declares an anomaly detector that reads session state.
 * @param ctx - Cordis context (currently unused; reserved for `ctx.anomalies`).
 */
export const apply = (_ctx: Context): void => {}
