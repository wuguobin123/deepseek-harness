/**
 * Generic WebSocket downlink for the two dsh stream carriers
 * (`/api/events.mux`, `/api/events.host`).
 *
 * The host exposes these paths as WebSocket-upgrade routes — plain GET
 * returns 426 Upgrade Required (see `packages/client/connection/src/index.ts`
 * line 150 and `websocket-downlink.ts`). Each message is one JSON
 * `ServerRequest` envelope `{ type:'server-request', rpcId, method, payload }`.
 *
 * Idle streams abort with a typed `WsStreamError`; consumers see failures
 * instead of silent disconnects. The host never sends mid-stream `stream/error`
 * frames — a frame whose `payload.type === 'stream/error'` is what an
 * upstream impl failure becomes on the wire, so we surface it as a parse
 * success and let the IPC handler fan it out like any other frame.
 */
import WebSocket from 'ws'
import { ServerRequestSchema } from '../shared/contracts'

export class WsStreamError extends Error {
  readonly code: 'NETWORK_ERROR' | 'STREAM_IDLE' | 'BAD_FRAME'
  constructor(code: WsStreamError['code'], message: string) {
    super(message)
    this.name = 'WsStreamError'
    this.code = code
  }
}

export interface OpenWsStreamOptions {
  /** Idle timeout before the stream is treated as dead. */
  idleTimeoutMs?: number
  signal?: AbortSignal
}

const DEFAULT_IDLE_TIMEOUT_MS = 90_000

export async function* openWsStream(
  url: string,
  options: OpenWsStreamOptions = {},
): AsyncGenerator<{ rpcId: string; method: string; payload: unknown }> {
  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
  const externalSignal = options.signal
  const socket = new WebSocket(url)

  // The ws library closes when you set readyState to CLOSED via .close(); the
  // first emit of 'message' tells us the handshake succeeded.
  const opened = new Promise<void>((resolve, reject) => {
    const onOpen = (): void => {
      cleanup()
      resolve()
    }
    const onError = (err: Error): void => {
      cleanup()
      reject(err)
    }
    const cleanup = (): void => {
      socket.off('open', onOpen)
      socket.off('error', onError)
    }
    socket.once('open', onOpen)
    socket.once('error', onError)
  })

  try {
    await opened
  } catch (err) {
    try { socket.terminate() } catch { /* already gone */ }
    throw new WsStreamError('NETWORK_ERROR', `WS handshake failed: ${String(err)}`)
  }

  // Queue frames as they arrive; the async generator drains it. We can't
  // await each emit because the generator runs in the consumer's tick.
  const queue: Array<{ rpcId: string; method: string; payload: unknown }> = []
  const waiters: Array<(value: IteratorResult<{ rpcId: string; method: string; payload: unknown }>) => void> = []
  let closed = false
  let failure: Error | null = null

  let idleTimer: ReturnType<typeof setTimeout> | null = null
  const resetIdle = (): void => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      failure = new WsStreamError('STREAM_IDLE', `WS stream idle for ${idleTimeoutMs}ms`)
      socket.terminate()
    }, idleTimeoutMs)
  }

  const deliver = (frame: { rpcId: string; method: string; payload: unknown } | null): void => {
    const waiter = waiters.shift()
    if (waiter) {
      waiter(frame === null ? { value: undefined, done: true } : { value: frame, done: false })
      return
    }
    if (frame !== null) queue.push(frame)
  }

  socket.on('message', (raw: WebSocket.RawData) => {
    resetIdle()
    let parsed: { rpcId: string; method: string; payload?: unknown }
    try {
      const json = JSON.parse(raw.toString('utf8'))
      parsed = ServerRequestSchema.parse(json)
    } catch (err) {
      failure = new WsStreamError('BAD_FRAME', `WS data is not a ServerRequest: ${String(err)}`)
      socket.terminate()
      return
    }
    deliver({ rpcId: parsed.rpcId, method: parsed.method, payload: parsed.payload ?? null })
  })
  socket.on('close', () => {
    closed = true
    deliver(null)
  })
  socket.on('error', (err: Error) => {
    if (!failure) failure = new WsStreamError('NETWORK_ERROR', `WS stream error: ${err.message}`)
    closed = true
    deliver(null)
  })

  resetIdle()

  if (externalSignal) {
    const onAbort = (): void => {
      try { socket.close() } catch { /* ignore */ }
    }
    if (externalSignal.aborted) onAbort()
    else externalSignal.addEventListener('abort', onAbort, { once: true })
  }

  try {
    while (true) {
      if (failure) throw failure
      if (queue.length > 0) {
        const next = queue.shift() as { rpcId: string; method: string; payload: unknown }
        yield next
        continue
      }
      if (closed) return
      const next = await new Promise<IteratorResult<{ rpcId: string; method: string; payload: unknown }>>((resolve) => {
        waiters.push(resolve)
      })
      if (next.done) {
        if (failure) throw failure
        return
      }
      yield next.value
    }
  } finally {
    if (idleTimer) clearTimeout(idleTimer)
    try { socket.close() } catch { /* ignore */ }
  }
}
