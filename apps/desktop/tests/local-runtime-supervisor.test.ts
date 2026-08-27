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
})
