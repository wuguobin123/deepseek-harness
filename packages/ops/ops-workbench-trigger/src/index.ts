/**
 * `@deepseek-ai/dsh-ops-workbench-trigger` — Phase 1 skeleton.
 *
 * Cross-session trigger surface for the ops product: cron schedules and event
 * subscriptions that outlive a single session. Session-local reminders borrow
 * `@deepseek-ai/dsh-schedule`; this package adds the cross-session half, namely
 * the `@schedule` global trigger and event listening. The skeleton registers no
 * service today; the global trigger implementation lands with the first scenario
 * that needs cross-session reminders.
 *
 * @module @deepseek-ai/dsh-ops-workbench-trigger
 */

import type { Context } from '@deepseek-ai/cordis'

/** Cordis plugin name used by `cordis.yml`. */
export const name = 'ops-workbench-trigger'
/** Services this plugin requires; reserved for the cross-session trigger surface. */
export const inject: string[] = ['sessions']
/** No configurable surface yet; config lands with the global trigger implementation. */
export interface Config {}

/**
 * Phase 1 entry point. The plugin is intentionally a no-op until the first
 * scenario that needs cross-session reminders lands.
 * @param ctx - Cordis context (currently unused; reserved for `ctx.triggers`).
 */
export const apply = (_ctx: Context): void => {}
