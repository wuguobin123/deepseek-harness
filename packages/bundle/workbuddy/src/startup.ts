/**
 * `@deepseek-ai/dsh-workbuddy/startup` — provides the optional one-shot
 * task the workbuddy profile consumes. Reads a single positional
 * command-line argument (`pnpm dsh --profile workbuddy "task"`); when
 * absent, registers no task and the process idles while the api-proxy
 * serves the desktop / web clients. The bind port is read from
 * `WORKBUDDY_PORT` (default 18000) and published alongside the task on
 * the {@link WORKBUDDY_STARTUP_SERVICE} Cordis service.
 *
 * @module @deepseek-ai/dsh-workbuddy/startup
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-cmdline'

/** Stable Cordis service name the workbuddy profile consumes (task + port). */
export const WORKBUDDY_STARTUP_SERVICE = 'workbuddyStartup'

/** Immutable values the {@link WORKBUDDY_STARTUP_SERVICE} service carries. */
export interface WorkbuddyStartupValues {
  /** One-shot task, or empty when the process runs as a long-lived service. */
  readonly task: string
  /** Bound TCP port (default 18000, override via `WORKBUDDY_PORT`). */
  readonly port: number
}

/** Required services: the cmdline parser for positional argv. */
export const inject = ['cmdlineArgs']

/** Plugin name used by `cordis.yml`. */
export const name = 'workbuddy-startup'

/** No configurable surface; everything resolves from CLI flags and env. */
export interface Config {}

/**
 * Publish the parsed startup values to the rest of the workbuddy profile.
 *
 * Unlike the one-shot `dsh-headless` surface, workbuddy is a long-lived
 * multi-user HTTP carrier; an empty positional argv is the normal idle
 * state (the api-proxy serves desktop clients through the bound port).
 * Missing task / port simply yields the empty defaults — we do not
 * `program.error` here, so `pnpm dsh --profile workbuddy` boots clean.
 * @param ctx - Cordis context with `cmdlineArgs` already injected.
 */
export function apply(ctx: Context): void {
  const cmdlineArgs = ctx.get('cmdlineArgs')
  const args = cmdlineArgs === undefined ? [] : Array.from(cmdlineArgs.get())
  const portRaw = Number.parseInt(process.env['WORKBUDDY_PORT'] ?? '18000', 10)
  const port = Number.isFinite(portRaw) && portRaw > 0 ? portRaw : 18000
  const values: WorkbuddyStartupValues = { task: args.join(' ').trim(), port }
  ctx.provide(WORKBUDDY_STARTUP_SERVICE, values)
}
