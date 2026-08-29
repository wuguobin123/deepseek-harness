import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { LocalRuntimeSupervisor } from '../src/main/local-runtime-supervisor'

interface FakeChild extends EventEmitter {
  stdout: PassThrough
  stderr: PassThrough
  exitCode: number | null
  signalCode: string | null
  connected: boolean
  sent: string[]
  send(message: string): boolean
  kill(signal: string): void
}

function child(): FakeChild {
  const proc = new EventEmitter() as FakeChild
  proc.stdout = new PassThrough()
  proc.stderr = new PassThrough()
  proc.exitCode = null
  proc.signalCode = null
  proc.connected = true
  proc.sent = []
  proc.send = vi.fn((message: string) => {
    proc.sent.push(message)
    return true
  })
  proc.kill = vi.fn((signal: string) => {
    if (signal === 'SIGTERM') {
      proc.signalCode = signal
      proc.emit('exit', null, signal)
    }
  })
  return proc
}

describe('LocalRuntimeSupervisor', () => {
  it('accepts only the exact loopback readiness line', async () => {
    const proc = child()
    const spawnImpl = vi.fn(() => proc as never)
    const supervisor = new LocalRuntimeSupervisor({
      userDataPath: '/tmp/test',
      runtimeBin: '/runtime',
      spawnImpl,
    })
    const started = supervisor.start()
    const concurrent = supervisor.start()
    proc.stdout.write('dsh web: http://127.0.0.1:99 (LAN: http://x:99)\n')
    proc.stdout.write('dsh web: http://127.0.0.1:4321\n')
    await expect(started).resolves.toBe('http://127.0.0.1:4321')
    await expect(concurrent).resolves.toBe('http://127.0.0.1:4321')
    expect(spawnImpl).toHaveBeenCalledOnce()
    await supervisor.stop()
  })

  it('times out and force-kills an uncooperative child', async () => {
    const proc = child()
    const kill = vi.fn((signal: string) => {
      if (signal === 'SIGKILL') {
        proc.signalCode = signal
        proc.emit('exit', null, signal)
      }
    })
    proc.kill = kill
    const supervisor = new LocalRuntimeSupervisor({
      userDataPath: '/tmp/test',
      runtimeBin: '/runtime',
      timeoutMs: 5,
      shutdownGraceMs: 1,
      spawnImpl: () => proc as never,
    })
    await expect(supervisor.start()).rejects.toThrow(/readiness/)
    expect(kill).toHaveBeenCalledWith('SIGTERM')
    expect(kill).toHaveBeenCalledWith('SIGKILL')
  })

  it('relays credential-free child requests through the parent bridge and returns chunks', async () => {
    const proc = child()
    const stream = vi.fn(async function* (request: unknown): AsyncGenerator<unknown> {
      expect(request).toEqual({ version: 1, model: 'MiniMax-M3', messages: [] })
      yield { type: 'finish', reason: { kind: 'stop' } }
    })
    const spawnImpl = vi.fn(() => proc as never)
    const supervisor = new LocalRuntimeSupervisor({
      userDataPath: '/tmp/test', runtimeBin: '/runtime', spawnImpl,
      inferenceBridge: { stream },
    })
    const started = supervisor.start()
    proc.stdout.write('dsh web: http://127.0.0.1:4321\n')
    await started
    proc.emit('message', JSON.stringify({
      type: 'xiaowei/inference/start', requestId: 'req-1',
      request: { version: 1, model: 'MiniMax-M3', messages: [] },
    }))
    await vi.waitFor(() => { expect(proc.sent).toHaveLength(2) })
    expect(proc.sent.map(message => JSON.parse(message))).toEqual([
      { type: 'xiaowei/inference/chunk', requestId: 'req-1', chunk: { type: 'finish', reason: { kind: 'stop' } } },
      { type: 'xiaowei/inference/complete', requestId: 'req-1' },
    ])
    const spawnOptions = (spawnImpl.mock.calls as unknown as Array<[string, string[], { stdio: string[] }]>)[0]?.[2]
    expect(spawnOptions?.stdio).toEqual(['ignore', 'pipe', 'pipe', 'ipc'])
    await supervisor.stop()
  })

  it('aborts old-account inference before an account switch', async () => {
    const proc = child()
    let aborted = false
    const supervisor = new LocalRuntimeSupervisor({
      userDataPath: '/tmp/test', runtimeBin: '/runtime', spawnImpl: () => proc as never,
      inferenceBridge: {
        stream: async function* (_request, signal): AsyncGenerator<unknown> {
          await new Promise<void>(resolve => signal.addEventListener('abort', () => {
            aborted = true
            resolve()
          }, { once: true }))
          yield* []
        },
      },
    })
    const started = supervisor.start()
    proc.stdout.write('dsh web: http://127.0.0.1:4321\n')
    await started
    proc.emit('message', JSON.stringify({
      type: 'xiaowei/inference/start', requestId: 'req-old',
      request: { version: 1, model: 'MiniMax-M3', messages: [] },
    }))
    await vi.waitFor(() => { expect(aborted).toBe(false) })
    await supervisor.cancelInferenceStreams('ACCOUNT_SESSION_CHANGED', '账号已切换')
    expect(aborted).toBe(true)
    expect(proc.sent.map(message => JSON.parse(message))).toContainEqual({
      type: 'xiaowei/inference/error', requestId: 'req-old',
      error: { code: 'ACCOUNT_SESSION_CHANGED', message: '账号已切换' },
    })
    await supervisor.stop()
  })

  it('relays credential-free search requests through the account bridge', async () => {
    const proc = child()
    const search = vi.fn(async (request: unknown) => {
      expect(request).toEqual({ query: 'OpenAI', maxResults: 2 })
      return {
        sources: [{ url: 'https://example.test/result', title: 'Result' }],
        truncated: false,
      }
    })
    const supervisor = new LocalRuntimeSupervisor({
      userDataPath: '/tmp/test', runtimeBin: '/runtime', spawnImpl: () => proc as never,
      searchBridge: { search },
    })
    const started = supervisor.start()
    proc.stdout.write('dsh web: http://127.0.0.1:4321\n')
    await started
    proc.emit('message', JSON.stringify({
      type: 'xiaowei/web-search/start', requestId: 'search-1',
      request: { query: 'OpenAI', maxResults: 2 },
    }))
    await vi.waitFor(() => { expect(proc.sent).toHaveLength(1) })
    expect(JSON.parse(proc.sent[0])).toEqual({
      type: 'xiaowei/web-search/result', requestId: 'search-1',
      result: {
        sources: [{ url: 'https://example.test/result', title: 'Result' }],
        truncated: false,
      },
    })
    await supervisor.stop()
  })

  it('aborts account search and reports the account transition to the Worker', async () => {
    const proc = child()
    let aborted = false
    const supervisor = new LocalRuntimeSupervisor({
      userDataPath: '/tmp/test', runtimeBin: '/runtime', spawnImpl: () => proc as never,
      searchBridge: {
        search: async (_request, signal) => await new Promise((_, reject) => {
          signal.addEventListener('abort', () => {
            aborted = true
            reject(signal.reason instanceof Error ? signal.reason : new Error('search aborted'))
          }, { once: true })
        }),
      },
    })
    const started = supervisor.start()
    proc.stdout.write('dsh web: http://127.0.0.1:4321\n')
    await started
    proc.emit('message', JSON.stringify({
      type: 'xiaowei/web-search/start', requestId: 'search-old', request: { query: 'old account' },
    }))
    await vi.waitFor(() => { expect(aborted).toBe(false) })
    await supervisor.cancelAccountRequests('ACCOUNT_SESSION_CHANGED', '账号已切换')
    expect(aborted).toBe(true)
    expect(proc.sent.map(message => JSON.parse(message))).toContainEqual({
      type: 'xiaowei/web-search/error', requestId: 'search-old',
      error: { code: 'ACCOUNT_SESSION_CHANGED', message: '账号已切换' },
    })
    await supervisor.stop()
  })

  it('rejects duplicate in-flight search request identifiers', async () => {
    const proc = child()
    const supervisor = new LocalRuntimeSupervisor({
      userDataPath: '/tmp/test', runtimeBin: '/runtime', spawnImpl: () => proc as never,
      searchBridge: { search: async (_request, signal) => await new Promise((_, reject) => {
        signal.addEventListener('abort', () => {
          reject(signal.reason instanceof Error ? signal.reason : new Error('search aborted'))
        }, { once: true })
      }) },
    })
    const started = supervisor.start()
    proc.stdout.write('dsh web: http://127.0.0.1:4321\n')
    await started
    const request = JSON.stringify({
      type: 'xiaowei/web-search/start', requestId: 'search-duplicate', request: { query: 'x' },
    })
    proc.emit('message', request)
    proc.emit('message', request)
    await vi.waitFor(() => { expect(proc.sent).toHaveLength(1) })
    expect(JSON.parse(proc.sent[0])).toEqual({
      type: 'xiaowei/web-search/error', requestId: 'search-duplicate',
      error: { code: 'IPC_DUPLICATE_REQUEST', message: '搜索请求标识重复' },
    })
    await supervisor.cancelAccountRequests()
    await supervisor.stop()
  })
})
