/**
 * `@deepseek-ai/dsh-ops/startup` — provides the bind port and optional
 * one-shot task the ops profile consumes. Reads a single positional
 * command-line argument (`pnpm dsh --profile ops "task"`); when absent,
 * registers no task and the process idles while the webserver handles
 * `/health`. The bind port is read from `DSH_OPS_PORT` (default 18000) and
 * published on the {@link OPS_STARTUP_SERVICE} Cordis service.
 *
 * @module @deepseek-ai/dsh-ops/startup
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-cmdline'

/** Stable Cordis service name the ops profile consumes (port + optional task). */
export const OPS_STARTUP_SERVICE = 'opsStartup'

/** Immutable values the {@link OPS_STARTUP_SERVICE} service carries. */
export interface OpsStartupValues {
  /** One-shot task, or empty when the process runs as a long-lived service. */
  readonly task: string
  /** Bound TCP port (default 18000, override via `DSH_OPS_PORT`). */
  readonly port: number
}

/** Required services: the cmdline parser for positional argv. */
export const inject = ['cmdlineArgs']

/** Plugin name used by `cordis.yml`. */
export const name = 'ops-startup'

/** No configurable surface; everything resolves from CLI flags and env. */
export interface Config {}

/**
 * Publish the parsed startup values to the rest of the ops profile.
 * @param ctx - Cordis context with `cmdlineArgs` already injected.
 */
export function apply(ctx: Context): void {
  const cmdlineArgs = ctx.get('cmdlineArgs')
  const args = cmdlineArgs === undefined ? [] : Array.from(cmdlineArgs.get())
  const portRaw = Number.parseInt(process.env['DSH_OPS_PORT'] ?? '18000', 10)
  const port = Number.isFinite(portRaw) && portRaw > 0 ? portRaw : 18000
  const values: OpsStartupValues = { task: args.join(' ').trim(), port }
  ctx.provide(OPS_STARTUP_SERVICE, values)
}