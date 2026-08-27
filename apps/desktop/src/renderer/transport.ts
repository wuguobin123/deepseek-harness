/**
 * Renderer-side transport adapter.
 *
 * Bridges the desktop's `window.workbenchApi` IPC surface to webUI's
 * `ClientTransportHooks` contract. The connection plugin reads the
 * `__DSH_TRANSPORT__` global at boot and, when present, uses our
 * `createApiClient()` instead of building its own Web fetch / WebSocket
 * client. It also reports whether the configured Host authority is loopback,
 * because the renderer's `file:` URL does not identify its network target.
 *
 * Carrier map:
 *   `window.workbenchApi.request`     → unary `POST /api/<method>`
 *   `window.workbenchApi.subscribeMux` → `GET /api/events.mux` (downlink)
 *   `window.workbenchApi.subscribeHost` → `GET /api/events.host` (downlink)
 *   `window.workbenchApi.respond`     → `POST /api/respond`
 *
 * The adapter extends `AbstractApiClient` from `@deepseek-ai/dsh-host-apiproxy/client`,
 * which already implements the entire `IApiClient` interface (sessions,
 * subagents, host, workspace, skills, agentPresets, goals, settings,
 * credentials, llm, events) over three transport primitives: `doFetch`
 * for unary, `openMux` for the mux downlink, `openHost` for the host
 * downlink. By overriding those three methods to route through the IPC
 * bridge, every one of the ~50 typed RPC methods on the IApiClient
 * surface just works — including `api.host.describe({})` which the
 * runtime's connection-handshake waits on.
 */
import { AbstractApiClient } from '@deepseek-ai/dsh-host-apiproxy/client'
import type { ClientTransportHooks } from '@deepseek-ai/dsh-client-connection/client'
import type { HostFrame, MuxFrame } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { ClientResponse, RpcReceipt, RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { hostFrameSchema, muxFrameSchema } from '@deepseek-ai/dsh-host-apiproxy/api/events.schema'
import { serverRequestSchema } from '@deepseek-ai/dsh-host-apiproxy/api/rpc.schema'

/** Wire envelope used by every `request` call. */
export interface WorkbenchResponse<T = unknown> {
  ok: boolean
  value?: T
  error?: { code: string; message: string; details?: Record<string, unknown> }
}

/** Subset of the preload bridge that the transport actually consumes. */
export interface WorkbenchApiTransport {
  request<R = unknown>(method: string, payload: unknown): Promise<WorkbenchResponse<R>>
  subscribeMux(listener: (envelope: unknown) => void): Promise<() => Promise<void>>
  subscribeHost(listener: (envelope: unknown) => void): Promise<() => Promise<void>>
  respond(
    rpcId: string,
    value: unknown,
    error?: { code: string; message: string; details?: Record<string, unknown> },
  ): Promise<void>
}

/** Carry one fetch-shaped ClientRequest through the Electron IPC bridge. */
async function ipcFetch(
  api: WorkbenchApiTransport,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const url = input instanceof URL
    ? input
    : new URL(typeof input === 'string' ? input : input.url, 'http://dsh.internal')
  const methodPath = url.pathname.replace(/^\/api\//, '')
  const rawBody = init?.body ?? (
    typeof Request !== 'undefined' && input instanceof Request
      ? await input.clone().text()
      : undefined
  )
  let payload: unknown = undefined
  if (rawBody !== undefined) {
    if (typeof rawBody !== 'string') {
      payload = rawBody
    } else {
      try {
        payload = JSON.parse(rawBody)
      } catch {
        payload = rawBody
      }
    }
  }
  const envelope = payload as { rpcId?: string; method?: string; payload?: unknown } | undefined
  const method = envelope?.method ?? methodPath
  const body = envelope?.payload ?? payload
  const res = await api.request(method, body)
  if (res.ok && res.value !== undefined) {
    return new Response(
      JSON.stringify({
        type: 'server-response',
        rpcId: envelope?.rpcId,
        result: { ok: true, value: res.value },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }
  const code = 'internal'
  const message = res.error?.message ?? 'unknown error'
  return new Response(
    JSON.stringify({
      type: 'server-response',
      rpcId: envelope?.rpcId,
      result: { ok: false, error: { code, message, details: {} } },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

/**
 * AbstractApiClient subclass that routes every transport call through the
 * Electron preload bridge. AbstractApiClient handles all envelope minting,
 * rpcId correlation, frame parsing, and reconnect logic — we only have to
 * map the three transport primitives.
 *
 * The base class's `doFetch(path, init)` is called for every unary POST.
 * The base class's `openMux`/`openHost` are virtual; we override them to
 * delegate to our IPC subscriptions and yield parsed frames.
 */
class IpcApiClientAdapter extends AbstractApiClient {
  constructor(private readonly api: WorkbenchApiTransport) {
    // The base class accepts a per-instance timeout; the default is fine.
    super()
  }

  /** Unary POST leg: route every `/api/<method>` through `window.workbenchApi.request`. */
  protected override async doFetch(input: URL, init?: RequestInit): Promise<Response> {
    return ipcFetch(this.api, input, init)
  }

  /** Mux downlink: subscribe via IPC, adapt the envelope stream. */
  protected override openMux(
    _payload: Parameters<NonNullable<AbstractApiClient['openMux']>>[0],
    signal: AbortSignal,
    onOpen?: () => void,
  ): AsyncIterable<RpcRequest<MuxFrame>> {
    return this.subscribeFrames(
      signal,
      onOpen,
      listener => this.api.subscribeMux(listener),
      muxFrameSchema,
    )
  }

  /** Host downlink: subscribe via IPC, adapt the envelope stream. */
  protected override openHost(
    _payload: Parameters<NonNullable<AbstractApiClient['openHost']>>[0],
    signal: AbortSignal,
    onOpen?: () => void,
  ): AsyncIterable<RpcRequest<HostFrame>> {
    return this.subscribeFrames(
      signal,
      onOpen,
      listener => this.api.subscribeHost(listener),
      hostFrameSchema,
    )
  }

  /**
   * Bypass `doFetch` for the response carrier.
   *
   * The upstream `/api/respond` handler
   * (`packages/host/apiproxy/src/fetch/handler.ts:329`) runs the body through
   * `clientResponseSchema.safeParse`. A `ClientRequest` envelope fails that
   * parse, so routing `respond()` through `doFetch` → `bridge().request()`
   * silently rejects every approval answer — the carrier returns
   * `{ accepted: false, reason: 'bad-response' }`, `PendingApproval.answer()`
   * throws, and the composer panel's `.catch(() => setAnswered(false))` re-arms
   * the buttons. The user sees "拒绝/允许一次 无反应".
   *
   * The preload exposes `respond()` as its own IPC channel
   * (`IpcChannels.Respond`); the main process forwards it to
   * `apiClient.respond()` (note: `respond`, not `call`) which POSTs the
   * `ClientResponse` envelope to the upstream `/api/respond` directly.
   */
  override async respond(message: ClientResponse): Promise<RpcReceipt> {
    this.onEnvelope(message)
    if (message.result.ok) {
      await this.api.respond(message.rpcId, message.result.value)
    } else {
      await this.api.respond(message.rpcId, undefined, message.result.error)
    }
    // The IPC bridge returns void (it does not relay the upstream RpcReceipt
    // body); the renderer only needs an accepted signal so the
    // `PendingApproval.answer()` guard passes and the panel leaves. The
    // authoritative `approval/resolved` frame still settles the pending list.
    return { accepted: true }
  }

  /**
   * Shared subscription adapter: turn `subscribeMux`/`subscribeHost` into
   * an `AsyncIterable<RpcRequest<Frame>>`. The IPC stream delivers
   * `ServerRequest` envelopes as plain objects; the AbstractApiClient
   * subclass pipeline parses them with the frame-specific Zod schema and
   * yields `RpcRequest<Frame>` (rpcId + payload).
   */
  private async *subscribeFrames<F extends MuxFrame | HostFrame>(
    signal: AbortSignal,
    onOpen: (() => void) | undefined,
    subscribe: (listener: (envelope: unknown) => void) => Promise<() => Promise<void>>,
    frameSchema: { parse(value: unknown): F },
  ): AsyncGenerator<RpcRequest<F>> {
    const queue: Array<{ kind: 'frame'; envelope: RpcRequest<F> } | { kind: 'end'; error?: unknown }> = []
    let wake: (() => void) | undefined
    const enqueue = (item: typeof queue[number]): void => {
      queue.push(item)
      wake?.()
      wake = undefined
    }
    let opened = false
    const listener = (rawEnvelope: unknown): void => {
      if (!opened) {
        opened = true
        onOpen?.()
      }
      try {
        // The desktop IPC bridge delivers `{ rpcId, method, payload }` (no
        // `type` discriminant — the preload strips transport-layer metadata
        // for cleanliness). The wire-level `serverRequestSchema` requires
        // `type: 'server-request'`; stamp it before parsing.
        const stamped = (rawEnvelope && typeof rawEnvelope === 'object' && !('type' in rawEnvelope))
          ? { type: 'server-request', ...(rawEnvelope as Record<string, unknown>) }
          : rawEnvelope
        const full = serverRequestSchema.parse(stamped)
        const frame = frameSchema.parse(full.payload)
        enqueue({ kind: 'frame', envelope: { rpcId: full.rpcId, payload: frame } })
      } catch (error) {
        console.error('[desktop-transport] dropping malformed downlink frame:', error)
      }
    }
    const unsubscribe = await subscribe(listener)
    const handleAbort = (): void => {
      enqueue({ kind: 'end' })
      void unsubscribe().catch(() => undefined)
    }
    signal.addEventListener('abort', handleAbort, { once: true })
    try {
      while (true) {
        while (queue.length > 0) {
          const item = queue.shift() as typeof queue[number]
          if (item.kind === 'end') return
          yield item.envelope
        }
        await new Promise<void>((resolve) => {
          wake = resolve
        })
      }
    } finally {
      signal.removeEventListener('abort', handleAbort)
      void unsubscribe().catch(() => undefined)
    }
  }
}

/**
 * Build the transport hooks the connection plugin will install before
 * its `apply()` runs. Returned object is assigned to
 * `window.__DSH_TRANSPORT__` by the desktop Cordis host.
 * @param api - desktop preload IPC bridge.
 * @param isLoopback - whether the configured Host URL targets loopback.
 * @returns connection transport hooks for this renderer boot.
 */
export function createSlotTransport(
  api: WorkbenchApiTransport,
  isLoopback: boolean,
): ClientTransportHooks {
  // The webUI `ClientTransportHooks` interface expects a full
  // `IApiClient` factory plus an optional `fetch`. Our IPC-backed
  // adapter exposes the entire `IApiClient` shape via AbstractApiClient;
  // every typed method routes through the IPC bridge.
  const hooks = {
    isLoopback,
    createApiClient: () => new IpcApiClientAdapter(api),
    fetch: (input: RequestInfo | URL, init?: RequestInit) => ipcFetch(api, input, init),
  }
  return hooks
}

/**
 * Install `__DSH_TRANSPORT__` on the page global.
 * @param api - desktop preload IPC bridge.
 * @param isLoopback - whether the configured Host URL targets loopback.
 * @returns the installed connection transport hooks.
 */
export function installTransport(
  api: WorkbenchApiTransport,
  isLoopback: boolean,
): ClientTransportHooks {
  const hooks = createSlotTransport(api, isLoopback)
  ;(globalThis as { __DSH_TRANSPORT__?: ClientTransportHooks }).__DSH_TRANSPORT__ = hooks
  return hooks
}
