/**
 * Preload bridge.
 *
 * The renderer only sees `window.workbenchApi` and nothing else. No
 * `ipcRenderer`, no `require`, no `process` access. Every method validates
 * its input against a shared Zod schema before sending IPC.
 *
 * Surface (per `shared/contracts.WORKBENCH_API_KEYS`):
 *   - request(method, payload) — generic RPC bridge.
 *   - subscribeMux(cb) / subscribeHost(cb) — SSE fan-out from the host's
 *     /api/events.mux and /api/events.host carriers.
 *   - respond(rpcId, value | error) — POST /api/respond with a ClientResponse
 *     envelope (the answer to a server-request frame).
 *   - getSession / updateSession — settings persistence (baseUrl only).
 *   - getAppUpdateState / checkAppUpdate / openAppUpdateDownload /
 *     subscribeAppUpdateState — stubbed update checker (always up-to-date).
 */
import { contextBridge, ipcRenderer } from 'electron'
import {
  AppUpdateStateSchema,
  ClientResponseSchema,
  IpcChannels,
  SessionStateSchema,
  WORKBENCH_API_KEYS,
  type AppUpdateState,
  type ClientResponse,
  type HostFrame,
  type MuxFrame,
  type SessionState,
} from '../shared/contracts'

const allowedChannels: ReadonlySet<string> = new Set(Object.values(IpcChannels))

function ensureChannel(channel: string): void {
  if (!allowedChannels.has(channel)) {
    throw new Error(`channel "${channel}" is not in the workbench API`)
  }
}

const api = {
  /** Generic RPC bridge: POST /api/<method> with a ClientRequest envelope. */
  async request(method: string, payload: unknown): Promise<{ ok: true; value: unknown } | { ok: false; error: { code: string; message: string } }> {
    if (typeof method !== 'string' || method.length === 0) {
      return { ok: false, error: { code: 'INVALID_INPUT', message: 'method must be a non-empty string' } }
    }
    return ipcRenderer.invoke(IpcChannels.Request, { method, payload }) as Promise<
      { ok: true; value: unknown } | { ok: false; error: { code: string; message: string } }
    >
  },

  /** Subscribe to MuxFrames via the SSE carrier GET /api/events.mux. */
  async subscribeMux(listener: (envelope: { rpcId: string; method: string; payload: MuxFrame }) => void): Promise<() => Promise<void>> {
    if (typeof listener !== 'function') {
      throw new TypeError('listener must be a function')
    }
    const channel = IpcChannels.MuxEvent
    ensureChannel(channel)
    const started = await ipcRenderer.invoke(IpcChannels.SubscribeMux)
    if (!(started as { ok?: boolean }).ok) {
      throw new Error((started as { error?: { message?: string } }).error?.message ?? 'failed to subscribe to mux stream')
    }
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      if (!payload || typeof payload !== 'object') return
      listener(payload as { rpcId: string; method: string; payload: MuxFrame })
    }
    ipcRenderer.on(channel, handler)
    return async () => {
      ipcRenderer.removeListener(channel, handler)
      await ipcRenderer.invoke(IpcChannels.UnsubscribeMux)
    }
  },

  /** Subscribe to HostFrames via the SSE carrier GET /api/events.host. */
  async subscribeHost(listener: (envelope: { rpcId: string; method: string; payload: HostFrame }) => void): Promise<() => Promise<void>> {
    if (typeof listener !== 'function') {
      throw new TypeError('listener must be a function')
    }
    const channel = IpcChannels.HostEvent
    ensureChannel(channel)
    const started = await ipcRenderer.invoke(IpcChannels.SubscribeHost)
    if (!(started as { ok?: boolean }).ok) {
      throw new Error((started as { error?: { message?: string } }).error?.message ?? 'failed to subscribe to host stream')
    }
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      if (!payload || typeof payload !== 'object') return
      listener(payload as { rpcId: string; method: string; payload: HostFrame })
    }
    ipcRenderer.on(channel, handler)
    return async () => {
      ipcRenderer.removeListener(channel, handler)
      await ipcRenderer.invoke(IpcChannels.UnsubscribeHost)
    }
  },

  /** POST /api/respond with a ClientResponse envelope. */
  async respond(rpcId: string, value: unknown, error?: { code: string; message: string; details?: Record<string, unknown> }): Promise<void> {
    const envelope: ClientResponse = error
      ? { type: 'client-response', rpcId, result: { ok: false, error: { code: error.code, message: error.message, details: error.details ?? {} } } }
      : { type: 'client-response', rpcId, result: { ok: true, value } }
    ClientResponseSchema.parse(envelope)
    await ipcRenderer.invoke(IpcChannels.Respond, envelope)
  },

  async getSession(): Promise<SessionState> {
    const session = await ipcRenderer.invoke(IpcChannels.GetSession)
    return SessionStateSchema.parse(session)
  },

  async updateSession(input: { baseUrl: string }): Promise<{ ok: true; value: { baseUrl: string } } | { ok: false; error: { code: string; message: string } }> {
    const parsed = SessionStateSchema.safeParse(input)
    if (!parsed.success) {
      return { ok: false, error: { code: 'INVALID_INPUT', message: parsed.error.message } }
    }
    return ipcRenderer.invoke(IpcChannels.UpdateSession, parsed.data) as Promise<
      { ok: true; value: { baseUrl: string } } | { ok: false; error: { code: string; message: string } }
    >
  },

  async getAppUpdateState(): Promise<AppUpdateState> {
    const state = await ipcRenderer.invoke(IpcChannels.GetAppUpdateState)
    return AppUpdateStateSchema.parse(state)
  },

  async checkAppUpdate(): Promise<AppUpdateState> {
    const state = await ipcRenderer.invoke(IpcChannels.CheckAppUpdate)
    return AppUpdateStateSchema.parse(state)
  },

  async openAppUpdateDownload(): Promise<void> {
    await ipcRenderer.invoke(IpcChannels.OpenAppUpdateDownload)
  },

  /** Subscribe to AppUpdateState fan-out (always up-to-date under the stub). */
  async subscribeAppUpdateState(listener: (state: AppUpdateState) => void): Promise<() => void> {
    if (typeof listener !== 'function') {
      throw new TypeError('listener must be a function')
    }
    const channel = IpcChannels.AppUpdateStateEvent
    ensureChannel(channel)
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      const parsed = AppUpdateStateSchema.safeParse(payload)
      if (!parsed.success) return
      listener(parsed.data)
    }
    ipcRenderer.on(channel, handler)
    return () => {
      ipcRenderer.removeListener(channel, handler)
    }
  },
}

const exposed: Record<string, unknown> = {}
for (const key of WORKBENCH_API_KEYS) {
  const impl = api[key as keyof typeof api]
  if (typeof impl === 'function') {
    exposed[key] = impl
  }
}

contextBridge.exposeInMainWorld('workbenchApi', exposed)

/** Type of the bridge surface exposed on `window.workbenchApi`. */
export type WorkbenchApi = typeof api
