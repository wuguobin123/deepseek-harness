/**
 * Main-process RPC + SSE client for dsh-ops.
 *
 * Two surfaces:
 *  - `call<T>(method, payload)` → POST `/api/<method>` with a `ClientRequest`
 *    envelope; validates the `ServerResponse` and returns the unwrapped value
 *    or throws an `RpcError`.
 *  - `streamMux()` / `streamHost()` → open `GET /api/events.mux` or
 *    `/api/events.host` and yield parsed frames via the shared sse-proxy.
 *
 * Trust: no auth headers are sent. The dsh-ops trust fence
 * (`dsh-client-connection.trustedHosts`) is the access boundary; requests
 * whose Host header isn't in the allow-list are rejected before reaching
 * the RPC dispatcher.
 */
import { URL } from 'node:url'
import { randomUUID } from 'node:crypto'
import type { ClientRequest, ClientResponse, ServerResponse } from '../shared/contracts'
import { ClientRequestSchema, ClientResponseSchema, ServerResponseSchema } from '../shared/contracts'
import type { Credentials } from './credential-store'
import { openWsStream } from './sse-proxy'

export interface ApiClientOptions {
  baseUrl: string
  fetchImpl?: typeof fetch
  requestTimeoutMs?: number
}

export class ApiClientError extends Error {
  readonly code: string
  readonly status: number
  readonly rpcMethod: string
  override readonly cause?: unknown
  constructor(rpcMethod: string, code: string, message: string, status: number, cause?: unknown) {
    super(message)
    this.name = 'ApiClientError'
    this.code = code
    this.status = status
    this.rpcMethod = rpcMethod
    this.cause = cause
  }
}

export class ApiClient {
  private baseUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly requestTimeoutMs: number

  constructor(options: ApiClientOptions) {
    this.baseUrl = ApiClient.normalizeBaseUrl(options.baseUrl)
    this.fetchImpl = options.fetchImpl ?? fetch
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000
  }

  setBaseUrl(baseUrl: string): void {
    this.baseUrl = ApiClient.normalizeBaseUrl(baseUrl)
  }

  getBaseUrl(): string {
    return this.baseUrl
  }

  private static normalizeBaseUrl(baseUrl: string): string {
    return baseUrl.replace(/\/$/, '')
  }

  /**
   * POST `/api/<method>` with a `ClientRequest` envelope; returns the
   * unwrapped `value` or throws `ApiClientError` on protocol/business failure.
   * Business-layer second parse (the `value` shape) is the caller's job.
   */
  async call<T = unknown>(method: string, payload: unknown): Promise<T> {
    const envelope: ClientRequest = {
      type: 'client-request',
      rpcId: randomUUID(),
      method,
      payload,
    }
    ClientRequestSchema.parse(envelope)
    const url = `${this.baseUrl}/api/${method}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs)
    let response: Response
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(envelope),
        signal: controller.signal,
      })
    } catch (err) {
      clearTimeout(timer)
      throw new ApiClientError(method, 'NETWORK_ERROR', 'request failed', 0, err)
    }
    clearTimeout(timer)
    const text = await response.text()
    let parsedJson: unknown = null
    if (text) {
      try {
        parsedJson = JSON.parse(text)
      } catch {
        throw new ApiClientError(method, `HTTP_${response.status}`, text, response.status)
      }
    }
    if (!response.ok) {
      throw new ApiClientError(method, `HTTP_${response.status}`, text || `HTTP ${response.status}`, response.status)
    }
    let parsed: ServerResponse
    try {
      parsed = ServerResponseSchema.parse(parsedJson)
    } catch (err) {
      throw new ApiClientError(method, 'BAD_RESPONSE', 'server response did not match ServerResponse schema', response.status, err)
    }
    if (parsed.rpcId !== envelope.rpcId) {
      throw new ApiClientError(method, 'BAD_RESPONSE', 'rpcId mismatch', response.status)
    }
    if (parsed.result.ok) {
      return parsed.result.value as T
    }
    const error = parsed.result.error
    throw new ApiClientError(method, error.code, error.message, response.status, error)
  }

  /**
   * POST `/api/respond` with a `ClientResponse` envelope (the answer to a
   * server-request frame like `approval/requested`). The host returns a
   * carrier receipt (`accepted: true | false`).
   */
  async respond(envelope: ClientResponse): Promise<void> {
    ClientResponseSchema.parse(envelope)
    const url = `${this.baseUrl}/api/respond`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs)
    let response: Response
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(envelope),
        signal: controller.signal,
      })
    } catch (err) {
      clearTimeout(timer)
      throw new ApiClientError('respond', 'NETWORK_ERROR', 'request failed', 0, err)
    }
    clearTimeout(timer)
    if (!response.ok) {
      const text = await response.text()
      throw new ApiClientError('respond', `HTTP_${response.status}`, text || `HTTP ${response.status}`, response.status)
    }
  }

  /** Open WS /api/events.mux and yield parsed ServerRequest envelopes. */
  streamMux(signal?: AbortSignal): AsyncIterable<{ rpcId: string; method: string; payload: unknown }> {
    return openWsStream(toWebSocketUrl(`${this.baseUrl}/api/events.mux`), { signal })
  }

  /** Open WS /api/events.host and yield parsed ServerRequest envelopes. */
  streamHost(signal?: AbortSignal): AsyncIterable<{ rpcId: string; method: string; payload: unknown }> {
    return openWsStream(toWebSocketUrl(`${this.baseUrl}/api/events.host`), { signal })
  }
}

/** Identity helper: credentials are read directly via snapshot() in the index. */
export type { Credentials }

/**
 * Translate an `http(s)://host:port/path` base into the equivalent `ws(s)://`
 * URL. The host's WebSocket downlinks live under the same origin as the RPC
 * POST routes; nginx (or another trusted reverse proxy in front of dsh-ops)
 * must forward the upgrade headers unchanged.
 */
function toWebSocketUrl(httpUrl: string): string {
  const parsed = new URL(httpUrl)
  parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:'
  return parsed.toString()
}
