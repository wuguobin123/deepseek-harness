/**
 * `@deepseek-ai/dsh-xiaowei/dev-logger` — registers a console exporter
 * on `ctx.logger` so any service that calls `ctx.logger.warn(...)` (e.g.
 * `LoggingEmailSender` in the dev / CI flow) writes to stderr.
 *
 * Cordis's built-in `LoggerService` only buffers in-memory; without an
 * exporter every log call is silently dropped. This plugin fills the
 * dev-facility gap so verification codes, bootstrap notices, and other
 * `ctx.logger` calls become visible in the xiaowei stdout / log file.
 *
 * Gated by `XIAOWEI_CONSOLE_LOGGER` (default `true` for now — the
 * multi-user bundle has no production logger story yet, and stdout is
 * the only place the desktop CDP probe can grep). Set to `false` to
 * fall back to silent (in-memory buffer only).
 *
 * @module @deepseek-ai/dsh-xiaowei/dev-logger
 */

import { Logger } from '@deepseek-ai/cordis'
import type { Message, Exporter, Context } from '@deepseek-ai/cordis'

/** Stable Cordis plugin name. */
export const name = 'xiaowei-dev-logger'

/** No services required — registers at boot. */
export const inject: string[] = []

/** No configurable surface. */
export interface Config {}

/**
 * Register a console exporter on the current context's logger. The
 * exporter emits each log record as one line to stderr (so it survives
 * log-rotation filters that grep on stdout) and returns the disposer
 * Cordis attaches to the current fiber.
 * @param ctx - Cordis context.
 */
export function apply(ctx: Context): void {
  const enabled = (process.env['XIAOWEI_CONSOLE_LOGGER'] ?? 'true') !== 'false'
  if (!enabled) return
  const exporter: Exporter = {
    colors: false,
    // `levels.default` is the *minimum* severity the exporter accepts.
    // Cordis's filter is `if (targetLevel < level) continue`; the numeric
    // levels are `ERROR = 0 < INFO = 1 < WARN = 2 < DEBUG = 3`, so
    // setting `default: 3` lets every severity pass. Setting it lower
    // (e.g. 0 = ERROR) would skip INFO and WARN, swallowing the
    // verification code emitted by LoggingEmailSender.
    levels: { default: 3 },
    maxLength: 8192,
    export(message: Message): void {
      const formatted = Logger.format(exporter, message)
      const ts = new Date(message.ts).toISOString()
      process.stderr.write(`[${ts}] [${message.type}] ${message.name}: ${formatted}\n`)
    },
  }
  ctx.logger.exporter(exporter)
}
