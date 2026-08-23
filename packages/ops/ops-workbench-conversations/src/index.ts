/**
 * `@deepseek-ai/dsh-ops-workbench-conversations` — Phase 1 skeleton.
 *
 * Hosts the multi-turn conversation surface for the ops product: tenant/actor
 * isolation, message streaming, and SSE event projection on top of the dsh
 * `core/session` and `session-persistence-sqlite` packages. This package
 * reserves the `ctx.conversations` projection so a future TS consumer can read
 * conversation history or attach SSE consumers without waiting for a new
 * scenario to land end-to-end.
 *
 * The skeleton registers no service today; the conversations projection lands
 * with the first scenario that needs multi-tenant chat history. That scenario
 * enters here together with its snapshot harness and any contract tests.
 *
 * @module @deepseek-ai/dsh-ops-workbench-conversations
 */

import type { Context } from '@deepseek-ai/cordis'

/** Cordis plugin name used by `cordis.yml`. */
export const name = 'ops-workbench-conversations'
/** Session service required before the projection can attach to the event stream. */
export const inject: string[] = ['sessions']
/** No configurable surface yet; config lands with the first scenario. */
export interface Config {}

/**
 * Phase 1 entry point. The plugin is intentionally a no-op until a scenario
 * declares a conversations projection.
 * @param ctx - Cordis context (currently unused; reserved for `ctx.conversations`).
 */
export const apply = (_ctx: Context): void => {}
