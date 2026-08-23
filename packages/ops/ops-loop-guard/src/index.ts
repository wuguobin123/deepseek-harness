/**
 * `@deepseek-ai/dsh-ops-loop-guard` — Phase 1 skeleton.
 *
 * Extends `@deepseek-ai/dsh-guard-repeat-tool-reminder` with the five-class loop
 * detection the ops product needs:
 *
 * 1. exact repeat — identical tool call replayed without change.
 * 2. ping-pong — alternating pair of tool calls with no progress.
 * 3. fatigue — rapid repeated calls regardless of equality.
 * 4. research stagnation — RAG queries without downstream consolidation.
 * 5. unknown capability repeat — calls to capabilities not in the registered manifest.
 *
 * The skeleton ships a no-op `apply`; the five detectors land with the first
 * scenario that triggers them. The reserved inject list declares the parent
 * reminder service so the companion invariant can assert ownership before any
 * detector extends the chain.
 *
 * @module @deepseek-ai/dsh-ops-loop-guard
 */

import type { Context } from '@deepseek-ai/cordis'

/** Cordis plugin name used by `cordis.yml`. */
export const name = 'ops-loop-guard'
/**
 * Skeleton has no service dependencies; the five detectors land with the
 * first scenario that triggers one. `repeat-tool-reminder` is a function
 * plugin that registers event handlers; no Cordis service is exposed.
 */
export const inject: string[] = []
/** No configurable surface yet; config lands with the first detector. */
export interface Config {}

/**
 * Phase 1 entry point. The plugin is intentionally a no-op until the first
 * scenario that triggers one of the five detection classes is接入ed.
 * @param ctx - Cordis context (currently unused; reserved for detector registration).
 */
export const apply = (_ctx: Context): void => {}
