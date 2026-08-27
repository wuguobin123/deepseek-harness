/**
 * `@deepseek-ai/dsh-ops` — the ops production profile bundle.
 *
 * The profile is a long-running service over `dsh-base`. Compared to
 * `dsh-headless` it (1) does NOT call `ctx.appExit` after one task — the
 * process keeps the HTTP listener alive for the systemd watchdog — (2) reads an
 * optional positional task from `ctx.opsStartup.task` and either runs that
 * task once (when provided) or idles while the webserver handles requests, and
 * (3) registers ops-* plugins as the patch layer above the base.
 *
 * The patched-in `ops-webserver` row binds `127.0.0.1:18000` (overridable via
 * the `DSH_OPS_PORT` env) and registers an exact `/health` route returning
 * `{"status":"ok"}`. The same row handles `/` with a small HTML index for
 * operator sanity. systemd polls `/health` to decide liveness.
 *
 * @module @deepseek-ai/dsh-ops
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-cmdline'
import { OPS_STARTUP_SERVICE, type OpsStartupValues } from './startup.ts'

/** Stable Cordis plugin name. */
export const name = 'ops-runner'

/** Core services required before the optional one-shot turn can start. */
export const inject = ['agentDefaultModel', 'agents', 'sessions', OPS_STARTUP_SERVICE]

/** Plugin config: the optional one-shot task, otherwise the process idles. */
export interface Config {
  /** Optional prompt text for a single foreground run on startup; empty = idle. */
  task: string
}

export const Config: z<Config> = z.object({
  task: z.string(),
})

interface OpsIo {
  stdout: { write(chunk: string): unknown }
  stderr: { write(chunk: string): unknown }
}

/** Injectable output streams used by tests of the one-shot ops runner. */
export const internals: { stdout: OpsIo['stdout']; stderr: OpsIo['stderr'] } = {
  stdout: process.stdout,
  stderr: process.stderr,
}

interface RunOutcome {
  text: string
  reason: SessionEvent<'turn/end'>['data']['reason'] | undefined
}

function summarize(events: readonly SessionEvent[], firstSeq: number): RunOutcome {
  let started = false
  let text = ''
  let reason: SessionEvent<'turn/end'>['data']['reason'] | undefined
  for (const event of events) {
    if (event.seq < firstSeq) continue
    if (event.type === 'turn/start') {
      started = true
      continue
    }
    if (!started) continue
    if (event.type === 'assistant/message') {
      const joined = event.data.message.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('')
      if (joined !== '') text = joined
    }
    if (event.type === 'turn/end') reason = event.data.reason
  }
  return { text, reason }
}

/**
 * Optional foreground task: when `config.task` is non-empty, drive one
 * user-supplied task through a fresh Agent and print its result. systemd watches
 * the HTTP `/health` endpoint for liveness, not this turn.
 */
async function runTask(ctx: Context, task: string, io: OpsIo): Promise<void> {
  await ctx.get('loader')?.await()
  const agents = ctx.get('agents')
  const defaultModel = ctx.get('agentDefaultModel')
  const sessions = ctx.get('sessions')
  if (agents === undefined || defaultModel === undefined || sessions === undefined) return
  const selection = defaultModel.currentSelection()
  const { agent } = await agents.create({
    sessionId: SessionId(`session-${randomUUID()}`),
    meta: { cwd: process.cwd() },
    agentOptions: { provider: selection.provider, model: selection.model },
    setup: (agentCtx) => {
      const selected: ModelSelectionRef = { current: selection, assembled: undefined }
      installModelSelection(agentCtx, selected)
    },
  })
  await agent.whenIdle()
  const firstSeq = agent.session.seq
  agent.followup(createUserMessage({
    content: [{ type: 'text', text: task }],
    source: { kind: 'user' },
  }))
  await agent.whenIdle()
  await sessions.flush(agent.session)
  const outcome = summarize(agent.session.events, firstSeq)
  io.stdout.write(outcome.text + '\n')
  if (outcome.reason?.kind === 'error') {
    io.stderr.write(`dsh-ops: ${outcome.reason.error.code}: ${outcome.reason.error.message}\n`)
  }
}

/**
 * Mount the ops runner. The HTTP `/health` endpoint bound by `ops-webserver`
 * owns liveness; the runner only drives a foreground task when one is provided.
 * @param ctx - plugin context.
 * @param config - validated config; `config.task` is optional.
 */
export function apply(ctx: Context, config: Config): void {
  const io: OpsIo = { stdout: internals.stdout, stderr: internals.stderr }
  // Source of truth is the OPS_STARTUP_SERVICE Cordis service published by
  // `ops-startup`; the `config.task` here is the patch-layer default and the
  // service value overrides it.
  const startup = ctx.get(OPS_STARTUP_SERVICE) as OpsStartupValues | undefined
  const task = (startup?.task ?? config.task).trim()
  if (task === '') return
  void runTask(ctx, task, io).catch((error: unknown) => {
    io.stderr.write(`dsh-ops: ${error instanceof Error ? error.message : String(error)}\n`)
  })
}
