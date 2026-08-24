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
  AuthStateSchema,
  ClientResponseSchema,
  IpcChannels,
  RequestEmailCodeInputSchema,
  RequestEmailCodeValueSchema,
  SessionStateSchema,
  SignInInputSchema,
  SignUpInputSchema,
  WORKBENCH_API_KEYS,
  type AppUpdateState,
  type AuthState,
  type ClientResponse,
  type HostFrame,
  type MuxFrame,
  type RequestEmailCodeValue,
  type SessionState,
} from '../shared/contracts'

const allowedChannels: ReadonlySet<string> = new Set(Object.values(IpcChannels))

function ensureChannel(channel: string): void {
  if (!allowedChannels.has(channel)) {
    throw new Error(`channel "${channel}" is not in the workbench API`)
  }
}

/** Canonical `ok / error` envelope every IPC handler returns. */
type IpcResult<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

const api = {
  /** Generic RPC bridge: POST /api/<method> with a ClientRequest envelope. */
  async request(method: string, payload: unknown): Promise<IpcResult<unknown>> {
    if (typeof method !== 'string' || method.length === 0) {
      return { ok: false, error: { code: 'INVALID_INPUT', message: 'method must be a non-empty string' } }
    }
    return ipcRenderer.invoke(IpcChannels.Request, { method, payload }) as Promise<IpcResult<unknown>>
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
  async respond(
    rpcId: string,
    value: unknown,
    error?: { code: string; message: string; details?: Record<string, unknown> },
  ): Promise<void> {
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

  async updateSession(input: { baseUrl: string }): Promise<IpcResult<{ baseUrl: string }>> {
    const parsed = SessionStateSchema.safeParse(input)
    if (!parsed.success) {
      return { ok: false, error: { code: 'INVALID_INPUT', message: parsed.error.message } }
    }
    return ipcRenderer.invoke(IpcChannels.UpdateSession, parsed.data) as Promise<IpcResult<{ baseUrl: string }>>
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

  // -------------------------------------------------------------------------
  // Auth — workbuddy multi-user bearer session lifecycle
  // -------------------------------------------------------------------------

  /** Cold-start probe: returns the currently-installed AuthState. */
  async getAuthState(): Promise<AuthState> {
    const raw = await ipcRenderer.invoke(IpcChannels.GetAuthState)
    return AuthStateSchema.parse(raw)
  },

  /**
   * Mint a fresh 6-digit email verification code. Public method — works
   * even when fully signed out (the user is trying to sign up).
   * @returns the value envelope `{ expiresInSeconds, retryAfterSeconds }`
   *   the host echoes back so the UI can drive the cooldown timer.
   */
  async requestEmailCode(input: { email: string }): Promise<IpcResult<RequestEmailCodeValue>> {
    const parsed = RequestEmailCodeInputSchema.safeParse(input)
    if (!parsed.success) {
      return { ok: false, error: { code: 'INVALID_INPUT', message: parsed.error.message } }
    }
    const result = await ipcRenderer.invoke(IpcChannels.RequestEmailCode, parsed.data)
    if (result && typeof result === 'object' && 'ok' in result && (result as { ok: boolean }).ok) {
      const value = RequestEmailCodeValueSchema.parse((result as { value: unknown }).value)
      return { ok: true, value }
    }
    return result as { ok: false; error: { code: string; message: string } }
  },

  /**
   * Register one account. Requires a verification code when the host's
   * email-verification seam is enabled. On success the bearer token is
   * persisted, installed on the main-process `ApiClient`, and broadcast.
   */
  async signUp(input: {
    email: string
    password: string
    displayName?: string
    verificationCode?: string
  }): Promise<IpcResult<AuthState>> {
    const parsed = SignUpInputSchema.safeParse(input)
    if (!parsed.success) {
      return { ok: false, error: { code: 'INVALID_INPUT', message: parsed.error.message } }
    }
    const result = await ipcRenderer.invoke(IpcChannels.SignUp, parsed.data)
    if (result && typeof result === 'object' && 'ok' in result && (result as { ok: boolean }).ok) {
      const value = AuthStateSchema.parse((result as { value: unknown }).value)
      return { ok: true, value }
    }
    return result as { ok: false; error: { code: string; message: string } }
  },

  /** Sign-in for an existing account. Same persistence + broadcast flow as signUp. */
  async signIn(input: { email: string; password: string }): Promise<IpcResult<AuthState>> {
    const parsed = SignInInputSchema.safeParse(input)
    if (!parsed.success) {
      return { ok: false, error: { code: 'INVALID_INPUT', message: parsed.error.message } }
    }
    const result = await ipcRenderer.invoke(IpcChannels.SignIn, parsed.data)
    if (result && typeof result === 'object' && 'ok' in result && (result as { ok: boolean }).ok) {
      const value = AuthStateSchema.parse((result as { value: unknown }).value)
      return { ok: true, value }
    }
    return result as { ok: false; error: { code: string; message: string } }
  },

  /** Revoke the current bearer token and clear the persisted session. */
  async signOut(): Promise<{ ok: true; value: AuthState }> {
    const result = await ipcRenderer.invoke(IpcChannels.SignOut)
    const value = AuthStateSchema.parse((result as { value: unknown }).value)
    return { ok: true, value }
  },

  /**
   * Subscribe to AuthState fan-out from main. The renderer stores the
   * latest snapshot in `useAuthStore`; cold-start should also `getAuthState`
   * once in case the broadcast raced the subscription.
   */
  async subscribeAuthState(listener: (state: AuthState) => void): Promise<() => void> {
    if (typeof listener !== 'function') {
      throw new TypeError('listener must be a function')
    }
    const channel = IpcChannels.AuthStateEvent
    ensureChannel(channel)
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      const parsed = AuthStateSchema.safeParse(payload)
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
