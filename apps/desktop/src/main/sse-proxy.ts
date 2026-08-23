/**
 * Generic SSE proxy for the two dsh stream carriers (`/api/events.mux`,
 * `/api/events.host`). The server emits `data:` lines whose body is a
 * ServerRequest envelope `{ type:'server-request', rpcId, method, payload }`;
 * `: connected` keepalive comments are skipped without disturbing parsing.
 *
 * Heartbeat: a fresh `data:` line (or the first comment byte) resets an idle
 * timeout; idle streams abort with a typed `SseStreamError`. Mid-stream impl
 * failures on the server emit one `stream/error` frame and then close (the
 * host's contract), so consumers see failures instead of silent disconnects.
 */
import { ServerRequestSchema } from '../shared/contracts'

export class SseStreamError extends Error {
  readonly code: 'NETWORK_ERROR' | 'STREAM_IDLE' | 'BAD_FRAME' | `HTTP_${number}`
  readonly status: number
  constructor(code: SseStreamError['code'], message: string, status = 0) {
    super(message)
    this.name = 'SseStreamError'
    this.code = code
    this.status = status
  }
}

export interface OpenSseStreamOptions {
  /** Idle timeout before the stream is treated as dead. */
  idleTimeoutMs?: number
  fetchImpl?: typeof fetch
  signal?: AbortSignal
}

const DEFAULT_IDLE_TIMEOUT_MS = 90_000

export async function* openSseStream(
  url: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): AsyncGenerator<{ rpcId: string; method: string; payload: unknown }> {
  const opts: OpenSseStreamOptions = { fetchImpl, signal }
  yield* openSseStreamInner(url, opts)
}

async function* openSseStreamInner(
  url: string,
  opts: OpenSseStreamOptions,
): AsyncGenerator<{ rpcId: string; method: string; payload: unknown }> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const idleTimeoutMs = opts.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
  const controller = new AbortController()
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort()
    else opts.signal.addEventListener('abort', () => controller.abort(), { once: true })
  }

  let response: Response
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: { accept: 'text/event-stream' },
      signal: controller.signal,
    })
  } catch (err) {
    throw new SseStreamError('NETWORK_ERROR', `SSE handshake failed: ${String(err)}`)
  }
  if (!response.ok || !response.body) {
    throw new SseStreamError(`HTTP_${response.status}` as const, `SSE handshake failed: HTTP ${response.status}`, response.status)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  const resetIdle = () => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => controller.abort(), idleTimeoutMs)
  }
  resetIdle()

  try {
    while (true) {
      const next = await reader.read()
      if (next.done) return
      resetIdle()
      buffer += decoder.decode(next.value, { stream: true })
      let boundary = findBoundary(buffer)
      while (boundary) {
        const frame = buffer.slice(0, boundary.index)
        buffer = buffer.slice(boundary.index + boundary.length)
        const parsed = parseFrame(frame)
        if (parsed) yield parsed
        boundary = findBoundary(buffer)
      }
    }
  } catch (err) {
    if (controller.signal.aborted && opts.signal?.aborted) return
    throw new SseStreamError('STREAM_IDLE', `SSE stream interrupted: ${String(err)}`)
  } finally {
    if (idleTimer) clearTimeout(idleTimer)
    try {
      reader.releaseLock()
    } catch {
      // already released
    }
  }
}

function findBoundary(value: string): { index: number; length: number } | null {
  const match = /\r?\n\r?\n/.exec(value)
  return match ? { index: match.index, length: match[0].length } : null
}

function parseFrame(frame: string): { rpcId: string; method: string; payload: unknown } | null {
  const dataLines: string[] = []
  for (const rawLine of frame.split(/\r?\n/)) {
    if (!rawLine || rawLine.startsWith(':')) continue
    if (rawLine.startsWith('data:')) {
      dataLines.push(rawLine.slice(5).trimStart())
    }
  }
  if (dataLines.length === 0) return null
  const value = dataLines.join('\n')
  let json: unknown
  try {
    json = JSON.parse(value)
  } catch {
    throw new SseStreamError('BAD_FRAME', 'SSE data line is not JSON')
  }
  const parsed = ServerRequestSchema.parse(json)
  return { rpcId: parsed.rpcId, method: parsed.method, payload: parsed.payload }
}
