/**
 * `@deepseek-ai/dsh-xiaowei/startup` — provides the optional one-shot
 * task the xiaowei profile consumes. Reads a single positional
 * command-line argument (`pnpm dsh --profile xiaowei "task"`); when
 * absent, registers no task and the process idles while the api-proxy
 * serves the desktop / web clients. The bind port is read from
 * `XIAOWEI_PORT` (default 18000) and published alongside the task on
 * the {@link XIAOWEI_STARTUP_SERVICE} Cordis service.
 *
 * @module @deepseek-ai/dsh-xiaowei/startup
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-cmdline'

/** Stable Cordis service name the xiaowei profile consumes (task + port). */
export const XIAOWEI_STARTUP_SERVICE = 'xiaoweiStartup'

/** Immutable values the {@link XIAOWEI_STARTUP_SERVICE} service carries. */
export interface XiaoweiStartupValues {
  /** One-shot task, or empty when the process runs as a long-lived service. */
  readonly task: string
  /** Bound TCP port (default 18000, override via `XIAOWEI_PORT`). */
  readonly port: number
}

/** Required services: the cmdline parser for positional argv. */
export const inject = ['cmdlineArgs']

/** Plugin name used by `cordis.yml`. */
export const name = 'xiaowei-startup'

/** No configurable surface; everything resolves from CLI flags and env. */
export interface Config {}

/**
 * Publish the parsed startup values to the rest of the xiaowei profile.
 *
 * Unlike the one-shot `dsh-headless` surface, xiaowei is a long-lived
 * multi-user HTTP carrier; an empty positional argv is the normal idle
 * state (the api-proxy serves desktop clients through the bound port).
 * Missing task / port simply yields the empty defaults — we do not
 * `program.error` here, so `pnpm dsh --profile xiaowei` boots clean.
 * @param ctx - Cordis context with `cmdlineArgs` already injected.
 */
export function apply(ctx: Context): void {
  const cmdlineArgs = ctx.get('cmdlineArgs')
  const args = cmdlineArgs === undefined ? [] : Array.from(cmdlineArgs.get())
  const portRaw = Number.parseInt(process.env['XIAOWEI_PORT'] ?? '18000', 10)
  const port = Number.isFinite(portRaw) && portRaw > 0 ? portRaw : 18000
  const values: XiaoweiStartupValues = { task: args.join(' ').trim(), port }
  ctx.provide(XIAOWEI_STARTUP_SERVICE, values)
}
