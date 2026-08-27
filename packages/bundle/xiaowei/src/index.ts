/**
 * `@deepseek-ai/dsh-xiaowei` — the xiaowei production profile bundle.
 *
 * The profile is a long-running multi-user surface over `dsh-base` +
 * `dsh-headless`. Compared to `dsh-ops` it (1) does NOT ship any ops-*
 * product plugins — its product surface is the multi-user xiaowei seam:
 * `identity` (invitation signup / referral limits / signin / signout), `email-verification` (6-digit
 * codes with cooldown / lockout), `wallet` (one-time 20-CNY welcome bonus +
 * ledger), `user-model-keys` (AES-256-GCM-encrypted bearer keys), and
 * `artifact-store-fs` (durable content-addressed products). The HTTP
 * `/api/<method>` carrier serves the desktop Electron client; `/health`
 * keeps the systemd watchdog happy.
 *
 * The patched-in `webserver` row binds `127.0.0.1:18000` (overridable via
 * `XIAOWEI_PORT`). The `api-proxy` row registers the wire methods:
 * `account.*`, `account.wallet.*`, `account.modelKeys.*`, `artifact.*`,
 * and the existing session/workspace/llm surface. The bundle runner is a
 * no-op when no positional task is provided — the process keeps the HTTP
 * listener alive.
 *
 * @module @deepseek-ai/dsh-xiaowei
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
import { XIAOWEI_STARTUP_SERVICE, type XiaoweiStartupValues } from './startup.ts'

/** Stable Cordis plugin name. */
export const name = 'xiaowei-runner'

/** Core services required before the optional one-shot turn can start. */
export const inject = ['agentDefaultModel', 'agents', 'sessions', XIAOWEI_STARTUP_SERVICE]

/** Plugin config: the optional one-shot task, otherwise the process idles. */
export interface Config {
  /** Optional prompt text for a single foreground run on startup; empty = idle. */
  task: string
}

export const Config: z<Config> = z.object({
  task: z.string(),
})

interface XiaoweiIo {
  stdout: { write(chunk: string): unknown }
  stderr: { write(chunk: string): unknown }
}

/** Injectable output streams used by tests of the one-shot Xiaowei runner. */
export const internals: { stdout: XiaoweiIo['stdout']; stderr: XiaoweiIo['stderr'] } = {
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
 * user-supplied task through a fresh Agent and print its result. The HTTP
 * `/api/<method>` carrier handles every signed-in client; the runner only
 * drives a foreground task when one is provided.
 */
async function runTask(ctx: Context, task: string, io: XiaoweiIo): Promise<void> {
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
    io.stderr.write(`dsh-xiaowei: ${outcome.reason.error.code}: ${outcome.reason.error.message}\n`)
  }
}

/**
 * Mount the xiaowei runner. The HTTP `/api/<method>` endpoint bound by
 * the api-proxy owns the surface; the runner only drives a foreground
 * task when one is provided.
 * @param ctx - plugin context.
 * @param config - validated config; `config.task` is optional.
 */
export function apply(ctx: Context, config: Config): void {
  const io: XiaoweiIo = { stdout: internals.stdout, stderr: internals.stderr }
  // Source of truth is the XIAOWEI_STARTUP_SERVICE Cordis service
  // published by `xiaowei-startup`; the `config.task` here is the
  // patch-layer default and the service value overrides it.
  const startup = ctx.get(XIAOWEI_STARTUP_SERVICE) as XiaoweiStartupValues | undefined
  const task = (startup?.task ?? config.task).trim()
  if (task === '') return
  void runTask(ctx, task, io).catch((error: unknown) => {
    io.stderr.write(`dsh-xiaowei: ${error instanceof Error ? error.message : String(error)}\n`)
  })
}
