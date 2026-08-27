import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import {
  parseAccountInferenceMessage,
  serializeAccountInferenceMessage,
  type AccountInferenceMessage,
} from '@deepseek-ai/dsh-llm-account-remote/ipc'

/** Authenticated cloud inference owned by the Electron parent process. */
export interface LocalInferenceBridge {
  stream(request: unknown, signal: AbortSignal): AsyncIterable<unknown>
}

export interface LocalRuntimeSupervisorOptions {
  userDataPath: string
  runtimeBin?: string
  timeoutMs?: number
  shutdownGraceMs?: number
  spawnImpl?: (
    file: string,
    args: string[],
    options: { env: NodeJS.ProcessEnv; stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
  ) => ChildProcess
  inferenceBridge?: LocalInferenceBridge
}

/** Owns the one supervised loopback dsh process used by local sessions. */
export class LocalRuntimeSupervisor {
  private child: ChildProcess | null = null
  private url: string | null = null
  private starting: Promise<string> | null = null
  private readonly inference = new Map<string, { controller: AbortController; task: Promise<void> }>()
  private readonly options: Required<Pick<LocalRuntimeSupervisorOptions, 'timeoutMs' | 'shutdownGraceMs'>>
  constructor(private readonly input: LocalRuntimeSupervisorOptions) {
    this.options = { timeoutMs: input.timeoutMs ?? 15_000, shutdownGraceMs: input.shutdownGraceMs ?? 2_000 }
  }

  get baseUrl(): string {
    if (this.url === null) throw new Error('local runtime is not ready')
    return this.url
  }

  async start(): Promise<string> {
    if (this.url !== null) return this.url
    if (this.starting !== null) return await this.starting
    const starting = this.startOnce()
    this.starting = starting
    try {
      return await starting
    } finally {
      if (this.starting === starting) this.starting = null
    }
  }

  private async startOnce(): Promise<string> {
    const runtimeBin = this.input.runtimeBin ?? join(process.cwd(), 'node_modules/@deepseek-ai/dsh/lib/bin.js')
    const spawnProcess = this.input.spawnImpl ?? ((file, args, options) => spawn(file, args, options))
    const child = spawnProcess(
      process.execPath,
      [runtimeBin, '--profile', 'xiaowei-local', '--host', '127.0.0.1', '--port', '0', '--no-open'],
      {
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
          DSH_HOME: join(this.input.userDataPath, 'local-runtime'),
        },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      },
    )
    this.child = child
    child.on('message', (value) => { this.handleInferenceMessage(child, value) })
    const ready = new Promise<string>((resolve, reject) => {
      let stderr = ''
      const timer = setTimeout(() => {
        reject(new Error(`local runtime did not announce readiness before timeout${stderr ? `: ${stderr}` : ''}`))
      }, this.options.timeoutMs)
      const stdout = child.stdout
      if (stdout === null) {
        clearTimeout(timer)
        reject(new Error('local runtime stdout is unavailable'))
        return
      }
      let announced = false
      child.stderr?.setEncoding('utf8')
      child.stderr?.on('data', (chunk: string) => {
        stderr = `${stderr}${chunk}`.trim().slice(-4096)
      })
      const lines = createInterface({ input: stdout })
      lines.on('line', (line) => {
        const match = /^dsh web: (http:\/\/127\.0\.0\.1:\d+)$/.exec(line.trim())
        if (match) {
          announced = true
          clearTimeout(timer)
          lines.close()
          resolve(match[1])
        }
      })
      child.once('error', (error) => {
        clearTimeout(timer)
        lines.close()
        reject(error)
      })
      child.once('exit', (code, signal) => {
        if (!announced) {
          clearTimeout(timer)
          lines.close()
          const cause = signal ? signal : `code ${code ?? 'unknown'}`
          reject(new Error(`local runtime exited (${cause})${stderr ? `: ${stderr}` : ''}`))
        }
      })
    })
    try {
      this.url = await ready
      return this.url
    } catch (error) {
      await this.stop()
      throw error
    }
  }

  async stop(): Promise<void> {
    await this.cancelInferenceStreams('IPC_UNAVAILABLE', '本机运行时已停止')
    const child = this.child
    this.child = null
    this.url = null
    if (child === null || child.exitCode !== null || child.signalCode !== null) return
    const exited = once(child, 'exit').then(() => undefined)
    child.kill('SIGTERM')
    const graceful = await Promise.race([
      exited.then(() => true),
      new Promise<false>(resolve => setTimeout(() => { resolve(false) }, this.options.shutdownGraceMs)),
    ])
    if (!graceful) {
      child.kill('SIGKILL')
      await exited.catch(() => undefined)
    }
  }

  /** Abort every account inference stream before credentials or account identity change. */
  async cancelInferenceStreams(code = 'ACCOUNT_SESSION_CHANGED', message = '账号状态已变更，请重试'): Promise<void> {
    const active = [...this.inference.entries()]
    for (const [requestId, stream] of active) {
      this.sendToChild({ type: 'xiaowei/inference/error', requestId, error: { code, message } })
      stream.controller.abort()
    }
    await Promise.all(active.map(([, stream]) => stream.task.catch(() => undefined)))
  }

  private handleInferenceMessage(child: ChildProcess, value: unknown): void {
    let message: AccountInferenceMessage
    try {
      message = parseAccountInferenceMessage(value)
    } catch {
      return
    }
    if (message.type === 'xiaowei/inference/cancel') {
      this.inference.get(message.requestId)?.controller.abort()
      return
    }
    if (message.type !== 'xiaowei/inference/start') return
    if (this.inference.has(message.requestId)) {
      this.sendToChild({
        type: 'xiaowei/inference/error',
        requestId: message.requestId,
        error: { code: 'IPC_DUPLICATE_REQUEST', message: '推理请求标识重复' },
      })
      return
    }
    const controller = new AbortController()
    const task = this.runInference(child, message.requestId, message.request, controller)
    this.inference.set(message.requestId, { controller, task })
    const cleanup = (): void => {
      if (this.inference.get(message.requestId)?.task === task) this.inference.delete(message.requestId)
    }
    void task.then(cleanup, cleanup)
  }

  private async runInference(
    child: ChildProcess,
    requestId: string,
    request: unknown,
    controller: AbortController,
  ): Promise<void> {
    const bridge = this.input.inferenceBridge
    if (bridge === undefined) {
      this.sendToChild({
        type: 'xiaowei/inference/error', requestId,
        error: { code: 'CLOUD_INFERENCE_UNAVAILABLE', message: '云端模型中继未配置' },
      }, child)
      return
    }
    try {
      for await (const chunk of bridge.stream(request, controller.signal)) {
        if (controller.signal.aborted) return
        this.sendToChild({ type: 'xiaowei/inference/chunk', requestId, chunk } as AccountInferenceMessage, child)
      }
      if (!controller.signal.aborted) this.sendToChild({ type: 'xiaowei/inference/complete', requestId }, child)
    } catch (error) {
      if (controller.signal.aborted) return
      this.sendToChild({
        type: 'xiaowei/inference/error', requestId,
        error: {
          code: typeof (error as { code?: unknown }).code === 'string'
            ? (error as { code: string }).code
            : 'CLOUD_INFERENCE_FAILED',
          message: error instanceof Error ? error.message : String(error),
        },
      }, child)
    }
  }

  private sendToChild(message: AccountInferenceMessage, child = this.child): void {
    if (child === null || typeof child.send !== 'function' || !child.connected) return
    try {
      child.send(serializeAccountInferenceMessage(message))
    } catch {
      // The child may exit between the connected check and send. Its stream
      // listeners disappear with the process, so there is no remaining peer.
    }
  }
}

export const __testing__ = { LocalRuntimeSupervisor }
