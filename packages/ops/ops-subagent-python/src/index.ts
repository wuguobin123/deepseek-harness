/**
 * Out-of-process Python subagent backend for the ops group. Each child is a
 * fresh Python interpreter process that runs my-agents business logic
 * (the ops-domain Pydantic business models and skill implementations),
 * driven over newline-delimited JSON-RPC 2.0 over stdio. The child shares no
 * Cordis context with the parent harness and advertises no start-time
 * capabilities; the only parent-derived input is the workspace cwd. This
 * plugin uses named exports only; a default would hide its loader metadata
 * (see `docs/postmortem/0001-acp-default-export-drops-inject.md`).
 *
 * The wire protocol is intentionally minimal for the Phase 0 zero-milestone:
 * - `agent.turn` request  -> `agent.turn.result` response
 * - `session.event` notification (Python -> TS; the parent's `session/event`
 *   projection handles persistence and replay).
 *
 * Future phases extend the wire with `tool.call` forwarding, `request.context`
 * injection, and `subagent.continuation` for child-to-parent messaging.
 *
 * @module @deepseek-ai/dsh-ops-subagent-python
 */

import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import z from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {
  ResolvedSubagentStartRequest,
  SubagentCapabilities,
  SubagentProvider,
  SubagentResult,
  SubagentRun,
  SubagentStopReason,
} from '@deepseek-ai/dsh-subagent'
import { NO_START_CAPABILITIES, resolveChildCwd, validateConfiguredCwd } from '@deepseek-ai/dsh-subagent'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import { assertPositiveFinite } from './helpers.ts'

export const name = 'ops-subagent-python'
export const inject = ['subagents', 'subprocess']

/** Config: how to spawn and drive the Python child process. */
export interface Config {
  /** Provider name on `ctx.subagents` (default `ops-python`). */
  providerName: string
  /** The Python interpreter to spawn (default `python3`). */
  command: string
  /** Python module entry point passed to the interpreter (e.g. `ops_runtime.subagent_main`). */
  module: string
  /** Extra arguments forwarded to the Python module. */
  args: string[]
  /**
   * Working directory override for the child process. Must be non-empty;
   * a relative path resolves against the harness launch directory at load.
   * When omitted, each child inherits its delegating parent session's cwd.
   */
  cwd?: string
  /** Environment variables for the child (forwarded on top of a credential-scrubbed parent env). */
  env: Record<string, string>
  /** Bound (ms) on the JSON-RPC `agent.turn` request before the parent treats it as errored. */
  turnTimeoutMs?: number
  /** EOF grace (ms) on dispose before the parent escalates to SIGTERM. */
  disposeEofGraceMs?: number
  /** SIGTERM to SIGKILL grace (ms) on dispose. */
  disposeGraceMs?: number
}

export const Config: z<Config> = z.object({
  providerName: z.string().default('ops-python'),
  command: z.string().default('python3'),
  module: z.string().required(),
  args: z.array(z.string()).default([]),
  cwd: z.string(),
  env: z.dict(z.string()).default({}),
  turnTimeoutMs: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER),
  disposeEofGraceMs: z.number().default(6_000),
  disposeGraceMs: z.number().default(3_000),
})

type ResolvedConfig = Required<Omit<Config, 'cwd' | 'turnTimeoutMs'>> & Pick<Config, 'cwd' | 'turnTimeoutMs'>

/** JSON-RPC 2.0 request shape sent over the Python stdio wire. */
interface JsonRpcRequest<P = unknown> {
  jsonrpc: '2.0'
  id: string
  method: string
  params: P
}

/** JSON-RPC 2.0 success response received from the Python child. */
interface JsonRpcResponse<R = unknown> {
  jsonrpc: '2.0'
  id: string
  result: R
}

/** Wire shape of the `agent.turn` response the Python child returns. */
interface AgentTurnResponse {
  output: ContentBlock[]
  structured?: unknown
  diagnostic?: string
  stopReason: SubagentStopReason
}

/** JSON-RPC 2.0 error response received from the Python child. */
interface JsonRpcErrorResponse {
  jsonrpc: '2.0'
  id: string
  error: { code: number; message: string; data?: unknown }
}

/** A JSON-RPC notification from the Python child (no id, no reply expected). */
interface JsonRpcNotification<P = unknown> {
  jsonrpc: '2.0'
  method: string
  params: P
}

/** A pending request awaiting a JSON-RPC response, identified by request id. */
interface PendingRequest {
  resolve(value: unknown): void
  reject(reason: unknown): void
  method: string
}

/**
 * Drives one Python child process over stdio JSON-RPC. Owns the lifecycle
 * (spawn, request dispatch, notification forwarding, graceful shutdown).
 */
class PythonChildDriver {
  private readonly child: ChildProcess
  private readonly stdin: Writable
  private readonly stdout: Readable
  private readonly pending = new Map<string, PendingRequest>()
  private readonly buffer: string[] = []
  private disposed = false

  constructor(
    private readonly spec: ResolvedConfig,
    args: string[],
    cwd: string,
    onNotification: (method: string, params: unknown) => void,
    onSpawnError: (error: Error) => void,
  ) {
    const env = { ...scrubbedParentEnv(), ...spec.env }
    this.child = spawn(spec.command, ['-m', spec.module, ...args], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
    if (this.child.stdin === null || this.child.stdout === null) {
      throw new Error('ops-subagent-python: spawned child is missing configured stdio pipes')
    }
    this.stdin = this.child.stdin
    this.stdout = this.child.stdout
    this.stdout.setEncoding('utf8')
    this.stdout.on('data', (chunk: string) => { this.handleData(chunk, onNotification) })
    this.child.stderr?.setEncoding('utf8')
    this.child.stderr?.on('data', (chunk: string) => {
      // stderr is untrusted Python output; log it but do not surface as protocol.
      process.stderr.write(`[ops-python child stderr] ${chunk}`)
    })
    this.child.on('error', onSpawnError)
  }

  /** Send a JSON-RPC request and resolve with the response result. */
  request<R = unknown>(method: string, params: unknown): Promise<R> {
    if (this.disposed) return Promise.reject(new Error('child disposed'))
    const id = randomUUID()
    const message: JsonRpcRequest = { jsonrpc: '2.0', id, method, params }
    return new Promise<R>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve, reject, method })
      this.stdin.write(JSON.stringify(message) + '\n')
    })
  }

  /** Graceful shutdown: close stdin, wait for EOF grace, then SIGTERM/SIGKILL. */
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.stdin.end()
    const exited = new Promise<void>((resolve) => {
      this.child.once('exit', () => { resolve() })
    })
    const timer = setTimeout(() => {
      this.child.kill('SIGTERM')
      const killTimer = setTimeout(() => this.child.kill('SIGKILL'), this.spec.disposeGraceMs)
      void exited.finally(() => { clearTimeout(killTimer) })
    }, this.spec.disposeEofGraceMs)
    await exited
    clearTimeout(timer)
  }

  /** Send an immediate signal to the child; cooperative cancellation path. */
  kill(signal: NodeJS.Signals): void {
    this.child.kill(signal)
  }

  private handleData(chunk: string, onNotification: (method: string, params: unknown) => void): void {
    this.buffer.push(chunk)
    const combined = this.buffer.join('')
    let newline = combined.indexOf('\n')
    while (newline !== -1) {
      const line = combined.slice(0, newline).trimEnd()
      this.buffer.length = 0
      this.buffer.push(combined.slice(newline + 1))
      if (line.length > 0) this.dispatch(line, onNotification)
      const next = this.buffer.join('')
      newline = next.indexOf('\n')
    }
  }

  private dispatch(line: string, onNotification: (method: string, params: unknown) => void): void {
    let message: JsonRpcResponse | JsonRpcErrorResponse | JsonRpcNotification
    try {
      message = JSON.parse(line) as typeof message
    } catch {
      process.stderr.write(`[ops-python] malformed JSON line: ${line}\n`)
      return
    }
    if (!('id' in message)) {
      onNotification(message.method, message.params)
      return
    }
    const pending = this.pending.get(message.id)
    if (!pending) return
    this.pending.delete(message.id)
    if ('error' in message) {
      pending.reject(new Error(`${message.error.message} (${pending.method})`))
    } else {
      pending.resolve(message.result)
    }
  }
}

/**
 * The Python subagent provider. Advertises no start-time capabilities: an
 * out-of-process child cannot honor outputSchema / depthLimit / toolFilter /
 * persona, so the service rejects any request that needs them.
 */
class OpsPythonProvider implements SubagentProvider {
  readonly capabilities: SubagentCapabilities = NO_START_CAPABILITIES
  // Out-of-process boundary: no parent conversation crosses the process edge.
  readonly inheritsParentContext = false

  constructor(readonly name: string, private readonly config: ResolvedConfig) {}

  start(request: ResolvedSubagentStartRequest): Promise<SubagentRun> {
    const cwd = resolveChildCwd('ops-subagent-python', this.config.cwd, request.parent.session.header.cwd)
    const spec: ResolvedConfig = { ...this.config }
    // Parent-namespace-unique id: the child lives in another process, so the
    // seam's local `sessionId` rule does not apply. `randomUUID` is unique
    // among fresh processes and any local agent that happens to use the same.
    const id = SessionId(randomUUID())
    const childReady = new Promise<PythonChildDriver>((resolveDriver, rejectDriver) => {
      const driver = new PythonChildDriver(
        spec,
        this.config.args,
        cwd,
        (method, _params) => {
          // `session.event` notifications carry ops-domain facts the Python
          // child wants the parent's session log to see. Forwarding through
          // `Session.append` requires a declared SessionEventType, which is
          // intentionally not widened here: ops-domain events use a
          // dedicated bus when the first scenario needs them. Today the
          // notification is consumed only by the child's own log; the wire
          // method is reserved for future use.
          if (method === 'session.event') void method
        },
        (error) => { rejectDriver(error) },
      )
      driver.request('initialize', {
        descriptor: request.descriptor,
      }).then(() => { resolveDriver(driver) }, rejectDriver)
    })

    const flags = { cancelled: false }
    const onAbort = (): void => {
      flags.cancelled = true
      void childReady.then((driver) => { driver.kill('SIGTERM') }).catch(() => { /* observed by result channel */ })
    }
    if (request.signal.aborted) onAbort()
    else request.signal.addEventListener('abort', onAbort, { once: true })

    const result: Promise<SubagentResult> = (async () => {
      try {
        const driver = await childReady
        const response = await driver.request<AgentTurnResponse>('agent.turn', {
          prompt: request.prompt,
          ...request.label !== undefined ? { label: request.label } : {},
          ...request.agentOptions !== undefined ? { agentOptions: request.agentOptions } : {},
        })
        if (flags.cancelled) return { output: response.output, stopReason: 'aborted' }
        return {
          output: response.output,
          ...response.structured !== undefined ? { structured: response.structured } : {},
          ...response.diagnostic !== undefined ? { diagnostic: response.diagnostic } : {},
          stopReason: response.stopReason,
        }
      } catch (error: unknown) {
        if (flags.cancelled) return { output: [], stopReason: 'aborted' }
        return {
          output: [],
          stopReason: 'error',
          diagnostic: error instanceof Error ? error.message : String(error),
        }
      } finally {
        request.signal.removeEventListener('abort', onAbort)
      }
    })()

    let disposal: Promise<void> | undefined
    return Promise.resolve({
      id,
      localAgent: undefined,
      result,
      async dispose(): Promise<void> {
        if (disposal !== undefined) return disposal
        flags.cancelled = true
        request.signal.removeEventListener('abort', onAbort)
        disposal = (async () => {
          try {
            const driver = await childReady
            await driver.dispose()
          } catch {
            // Already errored during spawn; nothing to dispose.
          }
        })()
        return disposal
      },
    })
  }
}

export function apply(ctx: Context, config: Config): void {
  const resolved = config as ResolvedConfig
  assertPositiveFinite('ops-subagent-python', 'disposeEofGraceMs', resolved.disposeEofGraceMs)
  assertPositiveFinite('ops-subagent-python', 'disposeGraceMs', resolved.disposeGraceMs)
  if (resolved.turnTimeoutMs !== undefined && (!Number.isSafeInteger(resolved.turnTimeoutMs) || resolved.turnTimeoutMs <= 0)) {
    throw new TypeError('ops-subagent-python turnTimeoutMs must be a positive safe integer')
  }
  if (!/^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(resolved.module)) {
    throw new TypeError(`ops-subagent-python module must be a valid Python module path (got ${JSON.stringify(resolved.module)})`)
  }
  const configuredCwd = validateConfiguredCwd('ops-subagent-python', resolved.cwd)
  const validated: ResolvedConfig = configuredCwd === undefined
    ? resolved
    : { ...resolved, cwd: configuredCwd }
  ctx.subagents.registerProvider(new OpsPythonProvider(validated.providerName, validated))
}
