/**
 * `@deepseek-ai/dsh-ops-workbench-memories` — Phase 1 skeleton.
 *
 * Adapts the OpenViking memory store for the ops product: auto-extracts
 * memories from completed turns, persists them as Markdown, and surfaces them
 * through `ctx.memories`. The skeleton registers no service today; the
 * OpenViking adapter lands with the first scenario that needs cross-session
 * memory, together with its storage backend and extraction contract.
 *
 * @module @deepseek-ai/dsh-ops-workbench-memories
 */

import type { Context } from '@deepseek-ai/cordis'

/** Cordis plugin name used by `cordis.yml`. */
export const name = 'ops-workbench-memories'
/** Services this plugin requires; reserved for the OpenViking adapter. */
export const inject: string[] = ['sessions']
/** No configurable surface yet; config lands with the OpenViking adapter. */
export interface Config {}

/**
 * Phase 1 entry point. The plugin is intentionally a no-op until the first
 * scenario that needs cross-session memory lands.
 * @param ctx - Cordis context (currently unused; reserved for `ctx.memories`).
 */
export const apply = (_ctx: Context): void => {}
