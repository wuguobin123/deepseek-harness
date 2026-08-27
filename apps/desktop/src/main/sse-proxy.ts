/**
 * Generic WebSocket downlink for the two dsh stream carriers
 * (`/api/events.mux`, `/api/events.host`).
 *
 * The host exposes these paths as WebSocket-upgrade routes — plain GET
 * returns 426 Upgrade Required (see `packages/client/connection/src/index.ts`
 * line 150 and `websocket-downlink.ts`). Each message is one JSON
 * `ServerRequest` envelope `{ type:'server-request', rpcId, method, payload }`.
 *
 * Protocol ping/pong frames distinguish a quiet workspace from a silent dead
 * carrier. Missing pong deadlines abort with a typed `WsStreamError`, which
 * lets the renderer-owned connection controller reconnect both streams and
 * repull open sessions. The host never sends mid-stream `stream/error` frames
 * — a frame whose `payload.type === 'stream/error'` is what an upstream impl
 * failure becomes on the wire, so we surface it as a parse success and let the
 * IPC handler fan it out like any other frame.
 */
import WebSocket from 'ws'
import { ServerRequestSchema } from '../shared/contracts'

export class WsStreamError extends Error {
  readonly code: 'NETWORK_ERROR' | 'HEARTBEAT_TIMEOUT' | 'BAD_FRAME'
  constructor(code: WsStreamError['code'], message: string) {
    super(message)
    this.name = 'WsStreamError'
    this.code = code
  }
}

export interface OpenWsStreamOptions {
  /** Delay between WebSocket ping frames. */
  heartbeatIntervalMs?: number
  /** Maximum wait for a pong or another inbound frame after each ping. */
  heartbeatTimeoutMs?: number
  signal?: AbortSignal
  /** HTTP headers sent during the WebSocket upgrade. */
  headers?: Record<string, string>
}

const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 10_000

export async function* openWsStream(
  url: string,
  options: OpenWsStreamOptions = {},
): AsyncGenerator<{ rpcId: string; method: string; payload: unknown }> {
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS
  const heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS
  const externalSignal = options.signal
  const socket = new WebSocket(url, { headers: options.headers })

  // Queue frames as they arrive; the async generator drains it. We can't
  // await each emit because the generator runs in the consumer's tick. Install
  // these listeners before awaiting `open`: the host sends subscription
  // baselines immediately after upgrade and they must not race the continuation.
  const queue: Array<{ rpcId: string; method: string; payload: unknown }> = []
  const waiters: Array<(value: IteratorResult<{ rpcId: string; method: string; payload: unknown }>) => void> = []
  let closed = false
  let failure: Error | null = null

  const deliver = (frame: { rpcId: string; method: string; payload: unknown } | null): void => {
    const waiter = waiters.shift()
    if (waiter) {
      waiter(frame === null ? { value: undefined, done: true } : { value: frame, done: false })
      return
    }
    if (frame !== null) queue.push(frame)
  }

  let heartbeatDeadline: ReturnType<typeof setTimeout> | null = null
  const clearHeartbeatDeadline = (): void => {
    if (heartbeatDeadline !== null) clearTimeout(heartbeatDeadline)
    heartbeatDeadline = null
  }
  const fail = (error: WsStreamError): void => {
    if (failure !== null || closed) return
    failure = error
    clearHeartbeatDeadline()
    try {
      socket.terminate()
    } catch {
      closed = true
      deliver(null)
    }
  }
  const sendHeartbeat = (): void => {
    if (socket.readyState !== WebSocket.OPEN || heartbeatDeadline !== null) return
    heartbeatDeadline = setTimeout(() => {
      fail(new WsStreamError(
        'HEARTBEAT_TIMEOUT',
        `WS heartbeat received no pong for ${heartbeatTimeoutMs}ms`,
      ))
    }, heartbeatTimeoutMs)
    try {
      socket.ping(undefined, undefined, (error?: Error | null) => {
        if (error != null) {
          fail(new WsStreamError('NETWORK_ERROR', `WS ping failed: ${error.message}`))
        }
      })
    } catch (error) {
      fail(new WsStreamError('NETWORK_ERROR', `WS ping failed: ${String(error)}`))
      return
    }
  }
  socket.on('message', (raw: WebSocket.RawData) => {
    clearHeartbeatDeadline()
    let parsed: { rpcId: string; method: string; payload?: unknown }
    try {
      const text = typeof raw === 'string'
        ? raw
        : Array.isArray(raw)
          ? Buffer.concat(raw).toString('utf8')
          : Buffer.from(new Uint8Array(raw as ArrayBuffer)).toString('utf8')
      const json: unknown = JSON.parse(text)
      parsed = ServerRequestSchema.parse(json)
    } catch (err) {
      failure = new WsStreamError('BAD_FRAME', `WS data is not a ServerRequest: ${String(err)}`)
      socket.terminate()
      return
    }
    deliver({ rpcId: parsed.rpcId, method: parsed.method, payload: parsed.payload ?? null })
  })
  socket.on('pong', clearHeartbeatDeadline)
  socket.on('close', () => {
    closed = true
    deliver(null)
  })
  socket.on('error', (err: Error) => {
    if (!failure) failure = new WsStreamError('NETWORK_ERROR', `WS stream error: ${err.message}`)
    closed = true
    deliver(null)
  })

  const opened = new Promise<void>((resolve, reject) => {
    const onOpen = (): void => {
      cleanup()
      resolve()
    }
    const onError = (error: Error): void => {
      cleanup()
      reject(error)
    }
    const onClose = (): void => {
      cleanup()
      reject(new Error('WS closed during handshake'))
    }
    const cleanup = (): void => {
      socket.off('open', onOpen)
      socket.off('error', onError)
      socket.off('close', onClose)
    }
    socket.once('open', onOpen)
    socket.once('error', onError)
    socket.once('close', onClose)
  })

  let onAbort: (() => void) | undefined
  if (externalSignal) {
    onAbort = (): void => {
      try { socket.close() } catch { /* ignore */ }
    }
    if (externalSignal.aborted) onAbort()
    else externalSignal.addEventListener('abort', onAbort, { once: true })
  }

  try {
    await opened
  } catch (error) {
    if (externalSignal !== undefined && onAbort !== undefined) {
      externalSignal.removeEventListener('abort', onAbort)
    }
    try { socket.terminate() } catch { /* already gone */ }
    throw new WsStreamError('NETWORK_ERROR', `WS handshake failed: ${String(error)}`)
  }
  const heartbeatTimer = setInterval(sendHeartbeat, heartbeatIntervalMs)

  try {
    while (true) {
      const pendingFailure = failure as WsStreamError | null
      if (pendingFailure !== null) throw new WsStreamError(pendingFailure.code, pendingFailure.message)
      if (queue.length > 0) {
        const next = queue.shift() as { rpcId: string; method: string; payload: unknown }
        yield next
        continue
      }
      const next = await new Promise<IteratorResult<{ rpcId: string; method: string; payload: unknown }>>((resolve) => {
        waiters.push(resolve)
      })
      if (next.done) {
        const pendingFailure = failure as WsStreamError | null
        if (pendingFailure !== null) throw new WsStreamError(pendingFailure.code, pendingFailure.message)
        return
      }
      yield next.value
    }
  } finally {
    clearInterval(heartbeatTimer)
    clearHeartbeatDeadline()
    if (externalSignal !== undefined && onAbort !== undefined) {
      externalSignal.removeEventListener('abort', onAbort)
    }
    try { socket.close() } catch { /* ignore */ }
  }
}
