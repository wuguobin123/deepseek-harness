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
 * Trust: requests are gated twice — first by the dsh-ops `trustedHosts`
 * fence on the server side (loopback / nginx fronting), then by a bearer
 * token set via `setToken()`. Public methods
 * (`account.signup|signin|signout|emailCode`) ignore the token; every
 * privileged method (`host.describe`, `account.wallet.credit`, etc.)
 * requires `Authorization: Bearer <token>` and the host validates it
 * against `ctx.identity.validate()` before dispatch.
 */
import { URL } from 'node:url'
import { randomUUID } from 'node:crypto'
import type { ClientRequest, ClientResponse, ServerResponse } from '../shared/contracts'
import { ClientRequestSchema, ClientResponseSchema, ServerResponseSchema } from '../shared/contracts'
import type { Credentials } from './credential-store'
import { openWsStream } from './sse-proxy'
import {
  parseAccountInferenceFrame,
  type AccountInferenceFrame,
  type AccountInferenceRequest,
} from '@deepseek-ai/dsh-llm-account-inference'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'

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
  /** Bearer token set by `setToken`; `null` (default) omits the Authorization header. */
  private token: string | null = null

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

  /**
   * Install or clear the bearer token used to authenticate privileged
   * RPC calls. Passing `null` removes the `Authorization` header — the
   * public account.* methods still work; privileged methods will be
   * rejected by the host fence with `unauthenticated`.
   */
  setToken(token: string | null): void {
    this.token = token !== null && token.length > 0 ? token : null
  }

  /** Read the currently-installed bearer token. Used by IPC handlers to fan tokens into `account.signout`. */
  getToken(): string | null {
    return this.token
  }

  /** Compose the JSON request headers, layering `Authorization` when a token is installed. */
  private requestHeaders(): Record<string, string> {
    if (this.token === null) {
      return { 'content-type': 'application/json' }
    }
    return {
      'content-type': 'application/json',
      authorization: `Bearer ${this.token}`,
    }
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
    const timer = setTimeout(() =>{  controller.abort() }, this.requestTimeoutMs)
    let response: Response
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: this.requestHeaders(),
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
    const timer = setTimeout(() =>{  controller.abort() }, this.requestTimeoutMs)
    let response: Response
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: this.requestHeaders(),
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

  /**
   * Stream one account-billed model attempt for a device-owned Agent loop.
   * The bearer is added here in Electron and never enters the child process.
   */
  async *streamAccountInference(
    request: AccountInferenceRequest,
    signal: AbortSignal,
  ): AsyncIterable<StreamChunk> {
    const method = 'account.inference.stream'
    if (this.token === null) {
      throw new ApiClientError(method, 'ACCOUNT_AUTH_REQUIRED', '请先登录后使用账号模型', 401)
    }
    let response: Response
    try {
      response = await this.fetchImpl(`${this.baseUrl}/api/${method}`, {
        method: 'POST',
        headers: this.requestHeaders(),
        body: JSON.stringify(request),
        signal,
      })
    } catch (error) {
      if (signal.aborted) throw new ApiClientError(method, 'ABORTED', '模型请求已取消', 0, error)
      throw new ApiClientError(method, 'CLOUD_OFFLINE', '无法连接云端模型服务', 0, error)
    }
    if (!response.ok) {
      const body = await response.text()
      const code = response.status === 401 || response.status === 403
        ? 'ACCOUNT_AUTH_EXPIRED'
        : `HTTP_${response.status}`
      throw new ApiClientError(method, code, body || `HTTP ${response.status}`, response.status)
    }
    const mediaType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
    if (mediaType !== 'application/x-ndjson' || response.body === null) {
      throw new ApiClientError(method, 'BAD_RESPONSE', '云端模型流响应格式无效', response.status)
    }
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let pending = ''
    let sawFinish = false
    let sawDone = false
    const accept = (raw: string): AccountInferenceFrame => {
      let value: unknown
      try { value = JSON.parse(raw) } catch (error) {
        throw new ApiClientError(method, 'BAD_RESPONSE', '云端模型流包含无效 JSON', response.status, error)
      }
      try { return parseAccountInferenceFrame(value) } catch (error) {
        throw new ApiClientError(method, 'BAD_RESPONSE', '云端模型流帧无效', response.status, error)
      }
    }
    const handle = (frame: AccountInferenceFrame): StreamChunk | undefined => {
      if (sawDone) throw new ApiClientError(method, 'BAD_RESPONSE', '云端模型流在 done 后仍发送帧', response.status)
      if (frame.type === 'error') throw new ApiClientError(method, frame.code, frame.message, response.status)
      if (frame.type === 'done') {
        if (!sawFinish) throw new ApiClientError(method, 'BAD_RESPONSE', '云端模型流在 finish 前结束', response.status)
        sawDone = true
        return undefined
      }
      if (sawFinish) throw new ApiClientError(method, 'BAD_RESPONSE', '云端模型流在 finish 后仍发送 chunk', response.status)
      if (frame.chunk.type === 'finish') sawFinish = true
      // The strict wire parser validated every discriminant and branded string
      // field. Brands are process-local TypeScript identities, so restore the
      // canonical runtime type at this single transport boundary.
      return frame.chunk as StreamChunk
    }
    try {
      while (!sawDone) {
        const { value, done } = await reader.read()
        if (done) break
        pending += decoder.decode(value, { stream: true })
        while (true) {
          const lineEnd = pending.indexOf('\n')
          if (lineEnd < 0) break
          const line = pending.slice(0, lineEnd).trim()
          pending = pending.slice(lineEnd + 1)
          if (line.length === 0) continue
          const chunk = handle(accept(line))
          if (chunk !== undefined) yield chunk
        }
      }
      pending += decoder.decode()
      if (!sawDone && pending.trim().length > 0) {
        const chunk = handle(accept(pending.trim()))
        if (chunk !== undefined) yield chunk
      }
      if (!sawDone) throw new ApiClientError(method, 'BAD_RESPONSE', '云端模型流意外中断', response.status)
    } finally {
      await reader.cancel().catch(() => undefined)
    }
  }

  /** Open WS /api/events.mux and yield parsed ServerRequest envelopes. */
  streamMux(signal?: AbortSignal): AsyncIterable<{ rpcId: string; method: string; payload: unknown }> {
    return openWsStream(toWebSocketUrl(`${this.baseUrl}/api/events.mux`), { signal, headers: this.requestHeaders() })
  }

  /** Open WS /api/events.host and yield parsed ServerRequest envelopes. */
  streamHost(signal?: AbortSignal): AsyncIterable<{ rpcId: string; method: string; payload: unknown }> {
    return openWsStream(toWebSocketUrl(`${this.baseUrl}/api/events.host`), { signal, headers: this.requestHeaders() })
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
