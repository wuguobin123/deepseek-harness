/**
 * Typed ipcMain handlers.
 *
 * Slim surface for the dsh-ops backed Electron client:
 *  - `Request` → generic RPC bridge (renderer→main→dsh-ops `POST /api/<method>`).
 *  - `Respond` → POST `/api/respond` with a ClientResponse envelope.
 *  - `SubscribeMux` / `UnsubscribeMux` → open / tear down the SSE carrier
 *    GET /api/events.mux and fan frames out as `MuxEvent` IPC events.
 *  - `SubscribeHost` / `UnsubscribeHost` → the same for GET /api/events.host.
 *  - `GetSession` / `UpdateSession` → base URL and execution-environment persistence.
 *  - `GetAppUpdateState` / `CheckAppUpdate` / `OpenAppUpdateDownload` →
 *    forwarded to the (stubbed) UpdateChecker; the IPC channel remains so
 *    the renderer can keep its "check for updates" affordance.
 *  - `GetAuthState` / `RequestEmailCode` / `SignUp` / `SignIn` / `SignOut`
 *    → bearer session lifecycle for the xiaowei multi-user backend;
 *    persist the resulting token, install it on `ApiClient`, and broadcast
 *    the new `AuthState` over `IpcChannels.AuthStateEvent`.
 *
 * The renderer never holds raw `ipcRenderer`; the preload exposes only
 * `WORKBENCH_API_KEYS`.
 */
import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { z } from 'zod'
import {
  ArtifactActionInputSchema,
  ClientResponseSchema,
  DirectoryImportActionSchema,
  IpcChannels,
  MuxFrameSchema,
  HostFrameSchema,
  RequestEmailCodeInputSchema,
  SessionStateSchema,
  SignInInputSchema,
  SignUpInputSchema,
  type AuthState,
  type HostFrame,
  type MuxFrame,
  type RequestEmailCodeValue,
  type InstalledSkillRecord,
  type SkillDirectoryInstallResult,
} from '../shared/contracts'
import { ApiClient } from './api-client'
import { CredentialStore } from './credential-store'
import type { ArtifactFileActions } from './artifact-files'
import type { UpdateChecker } from './update-checker'
import { readLocalDirectory } from './directory-import'
import type { RoutedClient } from './connection-router'

interface HandlersDeps {
  apiClient: ApiClient
  router?: RoutedClient
  credentialStore: CredentialStore
  baseUrl: () => string
  updateChecker: () => UpdateChecker
  artifactFiles: ArtifactFileActions
  mainWindow: () => BrowserWindow | null
  /**
   * Hook called whenever the auth state changes — `index.ts` wires this
   * to `mainWindow.webContents.send(IpcChannels.AuthStateEvent, state)`.
   * Receivers (the renderer `useAuthStore`) re-read state on every fan-out.
   */
  broadcastAuthState: (state: AuthState) => void
  /** Stop device model streams before the bearer, account, or cloud authority changes. */
  cancelLocalInferenceStreams?: (code?: string, message?: string) => Promise<void>
  /** On-device Skill store; only the main process handles its paths. */
  localSkillDirectory?: {
    list(): Promise<readonly InstalledSkillRecord[]>
    install(sourceDirectory: string): Promise<SkillDirectoryInstallResult>
  }
}

const RequestInputSchema = z.object({
  method: z.string().min(1),
  payload: z.unknown().optional(),
})

export interface IpcHandlers {
  install(): void
  uninstall(): void
}

interface ActiveStream {
  controller: AbortController
  task: Promise<void>
}

export function createIpcHandlers(deps: HandlersDeps): IpcHandlers {
  let mux: ActiveStream | null = null
  let host: ActiveStream | null = null

  /** Stop both carriers before changing credentials; no old-account frame may
   * reach a newly authenticated renderer generation. */
  async function stopStreams(): Promise<void> {
    const active = [mux, host]
    mux = null
    host = null
    for (const stream of active) {
      stream?.controller.abort()
    }
    await Promise.all(active.map(stream => stream === null ? Promise.resolve() : stream.task.catch(() => undefined)))
  }

  async function handleRequest(
    _event: Electron.IpcMainInvokeEvent,
    raw: unknown,
  ): Promise<{ ok: true; value: unknown } | { ok: false; error: { code: string; message: string } }> {
    const parsed = RequestInputSchema.safeParse(raw)
    if (!parsed.success) {
      return {
        ok: false,
        error: { code: 'bad-request', message: parsed.error.message },
      }
    }
    try {
      const value = await (deps.router ?? deps.apiClient).call(parsed.data.method, parsed.data.payload)
      return { ok: true, value }
    } catch (err) {
      const code = (err as { code?: string }).code ?? 'unknown'
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, error: { code, message } }
    }
  }

  async function handleImportDirectory(_event?: Electron.IpcMainInvokeEvent, raw?: unknown): Promise<
    { ok: true; value: unknown } | { ok: false; error: { code: string; message: string } }
  > {
    const action = DirectoryImportActionSchema.safeParse(raw)
    if (!action.success) {
      return { ok: false, error: { code: 'INVALID_INPUT', message: action.error.message } }
    }
    const location = action.data.location
    if (location === 'local') {
      const options: OpenDialogOptions = {
        title: '选择本机工作区',
        buttonLabel: '使用此目录',
        message: '本机目录不会整体复制到云端，但任务所需内容可能发送给模型服务。',
        properties: ['openDirectory'],
      }
      const window = deps.mainWindow()
      const picked = window === null
        ? await dialog.showOpenDialog(options)
        : await dialog.showOpenDialog(window, options)
      const pickedPath = picked.filePaths.at(0)
      if (picked.canceled || pickedPath === undefined) return { ok: true, value: { status: 'cancelled' } }
      try {
        const path = await realpath(pickedPath)
        return { ok: true, value: await (deps.router ?? deps.apiClient).call('workspace.create', { path, location: 'local' }) }
      } catch (error) {
        return {
          ok: false,
          error: {
            code: 'LOCAL_WORKSPACE_FAILED',
            message: error instanceof Error ? error.message : String(error),
          },
        }
      }
    }
    const options: OpenDialogOptions = {
      title: '导入本机目录副本',
      buttonLabel: '导入副本',
      message: '云端副本独立保存且不自动同步；任务所需内容可能发送给模型服务。',
      properties: ['openDirectory'],
    }
    const window = deps.mainWindow()
    const picked = window === null
      ? await dialog.showOpenDialog(options)
      : await dialog.showOpenDialog(window, options)
    const pickedPath = picked.filePaths.at(0)
    if (picked.canceled || pickedPath === undefined) return { ok: true, value: { status: 'cancelled' } }
    try {
      const copy = await readLocalDirectory(pickedPath)
      const importId = randomUUID()
      // The federation router tags the created Workspace before renderer selection.
      return { ok: true, value: await (deps.router ?? deps.apiClient).call('workspace.importDirectory', { importId, ...copy }) }
    } catch (error) {
      return {
        ok: false,
        error: { code: 'IMPORT_FAILED', message: error instanceof Error ? error.message : String(error) },
      }
    }
  }

  async function handleListSkills(): Promise<
    { ok: true; value: readonly InstalledSkillRecord[] }
    | { ok: false; error: { code: string; message: string } }
  > {
    if (deps.localSkillDirectory === undefined) {
      return { ok: false, error: { code: 'SKILL_STORE_UNAVAILABLE', message: '本机技能目录尚未就绪' } }
    }
    try {
      return { ok: true, value: await deps.localSkillDirectory.list() }
    } catch (error) {
      return { ok: false, error: { code: 'SKILL_LIST_FAILED', message: error instanceof Error ? error.message : String(error) } }
    }
  }

  async function handleInstallSkill(): Promise<
    { ok: true; value: SkillDirectoryInstallResult | { status: 'cancelled' } }
    | { ok: false; error: { code: string; message: string } }
  > {
    if (deps.localSkillDirectory === undefined) {
      return { ok: false, error: { code: 'SKILL_STORE_UNAVAILABLE', message: '本机技能目录尚未就绪' } }
    }
    const options: OpenDialogOptions = {
      title: '选择技能目录',
      buttonLabel: '安装技能',
      properties: ['openDirectory'],
    }
    const window = deps.mainWindow()
    const picked = window === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(window, options)
    const sourceDirectory = picked.filePaths.at(0)
    if (picked.canceled || sourceDirectory === undefined) return { ok: true, value: { status: 'cancelled' } }
    try {
      return { ok: true, value: await deps.localSkillDirectory.install(sourceDirectory) }
    } catch (error) {
      return { ok: false, error: { code: 'SKILL_INSTALL_FAILED', message: error instanceof Error ? error.message : String(error) } }
    }
  }

  async function handleRespond(_event: Electron.IpcMainInvokeEvent, raw: unknown): Promise<void> {
    const parsed = ClientResponseSchema.safeParse(raw)
    if (!parsed.success) {
      throw new Error(`invalid ClientResponse envelope: ${parsed.error.message}`)
    }
    await (deps.router ?? deps.apiClient).respond(parsed.data)
  }

  function handleGetSession(): { baseUrl: string } {
    const snapshot = deps.credentialStore.snapshot()
    const lastLocation = snapshot.lastLocation ?? 'cloud'
    return SessionStateSchema.parse({ baseUrl: snapshot.baseUrl, environment: lastLocation, lastLocation })
  }

  async function handleUpdateSession(
    _event: Electron.IpcMainInvokeEvent,
    raw: unknown,
  ): Promise<{ ok: true; value: { baseUrl: string } } | { ok: false; error: { code: string; message: string } }> {
    const parsed = SessionStateSchema.safeParse(raw)
    if (!parsed.success) {
      return { ok: false, error: { code: 'bad-request', message: parsed.error.message } }
    }
    try {
      const existing = deps.credentialStore.snapshot()
      const requestedLocation = parsed.data.lastLocation ?? parsed.data.environment ?? existing.lastLocation ?? 'cloud'
      await deps.credentialStore.saveConnection({
        baseUrl: parsed.data.baseUrl,
        lastLocation: requestedLocation,
      })
      await deps.cancelLocalInferenceStreams?.('CLOUD_AUTHORITY_CHANGED', '云端服务地址已变更，请重试')
      deps.apiClient.setBaseUrl(parsed.data.baseUrl)
      // Federation keeps both Hosts mounted in one renderer. The preference
      // records the last selected location for migration only; changing it
      // must not tear down the complete product UI.
      return { ok: true, value: { baseUrl: parsed.data.baseUrl } }
    } catch (err) {
      return {
        ok: false,
        error: {
          code: (err as { code?: string }).code ?? 'unknown',
          message: err instanceof Error ? err.message : String(err),
        },
      }
    }
  }

  async function startStream(
    wc: WebContents,
    eventName: string,
    open: (signal: AbortSignal) => AsyncIterable<unknown>,
    schema: { safeParse: (input: unknown) => { success: true; data: unknown } | { success: false; error: unknown } },
    previous: ActiveStream | null,
  ): Promise<ActiveStream> {
    if (previous) {
      previous.controller.abort()
      await previous.task.catch(() => undefined)
    }
    const controller = new AbortController()
    const task = (async () => {
      const sendStreamError = (message: string): void => {
        if (controller.signal.aborted || wc.isDestroyed()) return
        wc.send(eventName, {
          rpcId: 'desktop-stream-error',
          method: 'stream/error',
          payload: {
            type: 'stream/error',
            error: { code: 'internal', message, details: {} },
          },
        })
      }
      try {
        for await (const envelope of open(controller.signal)) {
          const parsed = schema.safeParse((envelope as { payload: unknown }).payload)
          if (!parsed.success) continue
          if (wc.isDestroyed()) return
          wc.send(eventName, {
            rpcId: (envelope as { rpcId: string }).rpcId,
            method: (envelope as { method: string }).method,
            payload: parsed.data,
          })
        }
        sendStreamError('Desktop event stream closed')
      } catch (err) {
        sendStreamError(err instanceof Error ? err.message : String(err))
      }
    })()
    return { controller, task }
  }

  async function handleSubscribeMux(
    event: Electron.IpcMainInvokeEvent,
  ): Promise<{ ok: true } | { ok: false; error: { code: string; message: string } }> {
    const wc = event.sender
    try {
      mux = await startStream(
        wc,
        IpcChannels.MuxEvent,
        signal => (deps.router ?? deps.apiClient).streamMux(signal),
        MuxFrameSchema,
        mux,
      )
      return { ok: true }
    } catch (err) {
      return {
        ok: false,
        error: {
          code: (err as { code?: string }).code ?? 'unknown',
          message: err instanceof Error ? err.message : String(err),
        },
      }
    }
  }

  async function handleUnsubscribeMux(): Promise<{ ok: true }> {
    if (mux) {
      mux.controller.abort()
      await mux.task.catch(() => undefined)
      mux = null
    }
    return { ok: true }
  }

  async function handleSubscribeHost(
    event: Electron.IpcMainInvokeEvent,
  ): Promise<{ ok: true } | { ok: false; error: { code: string; message: string } }> {
    const wc = event.sender
    try {
      host = await startStream(
        wc,
        IpcChannels.HostEvent,
        signal => (deps.router ?? deps.apiClient).streamHost(signal),
        HostFrameSchema,
        host,
      )
      return { ok: true }
    } catch (err) {
      return {
        ok: false,
        error: {
          code: (err as { code?: string }).code ?? 'unknown',
          message: err instanceof Error ? err.message : String(err),
        },
      }
    }
  }

  async function handleUnsubscribeHost(): Promise<{ ok: true }> {
    if (host) {
      host.controller.abort()
      await host.task.catch(() => undefined)
      host = null
    }
    return { ok: true }
  }

  function handleGetAppUpdateState(): ReturnType<UpdateChecker['getState']> {
    return deps.updateChecker().getState()
  }

  async function handleCheckAppUpdate(): Promise<ReturnType<UpdateChecker['getState']>> {
    return deps.updateChecker().check()
  }

  async function handleOpenAppUpdateDownload(): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      await deps.updateChecker().openDownload()
      return { ok: true }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  async function handleSaveArtifact(
    _event: Electron.IpcMainInvokeEvent,
    raw: unknown,
  ): Promise<{ ok: true; value: Awaited<ReturnType<ArtifactFileActions['save']>> } | { ok: false; error: { code: string; message: string } }> {
    const parsed = ArtifactActionInputSchema.safeParse(raw)
    if (!parsed.success) return { ok: false, error: { code: 'INVALID_INPUT', message: parsed.error.message } }
    try {
      return { ok: true, value: await deps.artifactFiles.save(parsed.data.artifactId) }
    } catch (error) {
      return {
        ok: false,
        error: { code: 'ARTIFACT_SAVE_FAILED', message: error instanceof Error ? error.message : String(error) },
      }
    }
  }

  async function handleOpenArtifactInBrowser(
    _event: Electron.IpcMainInvokeEvent,
    raw: unknown,
  ): Promise<{ ok: true; value: { opened: true } } | { ok: false; error: { code: string; message: string } }> {
    const parsed = ArtifactActionInputSchema.safeParse(raw)
    if (!parsed.success) return { ok: false, error: { code: 'INVALID_INPUT', message: parsed.error.message } }
    try {
      return { ok: true, value: await deps.artifactFiles.openHtmlInBrowser(parsed.data.artifactId) }
    } catch (error) {
      return {
        ok: false,
        error: { code: 'ARTIFACT_OPEN_FAILED', message: error instanceof Error ? error.message : String(error) },
      }
    }
  }

  // -------------------------------------------------------------------------
  // Auth — xiaowei multi-user bearer session lifecycle
  // -------------------------------------------------------------------------

  /** Persist a fresh session, install the bearer token, fan the new state out. */
  async function installSession(input: {
    baseUrl: string
    sessionToken: string
    userId: string
    displayName: string | null
    expiresAt: number
  }): Promise<AuthState> {
    await stopStreams()
    await deps.cancelLocalInferenceStreams?.('ACCOUNT_SESSION_CHANGED', '账号已切换，请重试')
    await deps.credentialStore.save({
      baseUrl: input.baseUrl,
      lastLocation: deps.credentialStore.snapshot().lastLocation,
      sessionToken: input.sessionToken,
      userId: input.userId,
      displayName: input.displayName,
      expiresAt: input.expiresAt,
    })
    deps.apiClient.setToken(input.sessionToken)
    const next: AuthState = deps.credentialStore.authState()
    deps.broadcastAuthState(next)
    return next
  }

  /** Clear the persisted session, drop the bearer token, broadcast signed-out state. */
  async function clearSession(): Promise<AuthState> {
    await stopStreams()
    await deps.cancelLocalInferenceStreams?.('ACCOUNT_SIGNED_OUT', '账号已退出登录')
    const baseUrl = deps.credentialStore.snapshot().baseUrl
    const existing = deps.credentialStore.snapshot()
    await deps.credentialStore.save({ baseUrl, lastLocation: existing.lastLocation })
    deps.apiClient.setToken(null)
    const next: AuthState = { signedIn: false }
    deps.broadcastAuthState(next)
    return next
  }

  function handleGetAuthState(): AuthState {
    return deps.credentialStore.authState()
  }

  async function handleRequestEmailCode(
    _event: Electron.IpcMainInvokeEvent,
    raw: unknown,
  ): Promise<{ ok: true; value: RequestEmailCodeValue } | { ok: false; error: { code: string; message: string } }> {
    const parsed = RequestEmailCodeInputSchema.safeParse(raw)
    if (!parsed.success) {
      return { ok: false, error: { code: 'INVALID_INPUT', message: parsed.error.message } }
    }
    try {
      // Public method: no bearer required, so this works even when the
      // user is fully signed out. The host rate-limits via its
      // email-verification seam (RESEND_COOLDOWN / RATE_LIMIT_EXCEEDED).
      const value = await deps.apiClient.call<RequestEmailCodeValue>(
        'account.emailCode',
        parsed.data,
      )
      return { ok: true, value }
    } catch (err) {
      return {
        ok: false,
        error: {
          code: (err as { code?: string }).code ?? 'unknown',
          message: err instanceof Error ? err.message : String(err),
        },
      }
    }
  }

  async function handleSignUp(
    _event: Electron.IpcMainInvokeEvent,
    raw: unknown,
  ): Promise<{ ok: true; value: AuthState } | { ok: false; error: { code: string; message: string } }> {
    const parsed = SignUpInputSchema.safeParse(raw)
    if (!parsed.success) {
      return { ok: false, error: { code: 'INVALID_INPUT', message: parsed.error.message } }
    }
    try {
      // Public method: the host fires the welcome bonus + provisions an
      // AES-encrypted user-model-key inside `account.signup`, so the
      // response carries a fully-formed bearer session.
      const signedIn = await deps.apiClient.call<{
        userId: string
        displayName: string | null
        sessionToken: string
        expiresAt: number
      }>('account.signup', parsed.data)
      const state = await installSession({
        baseUrl: deps.credentialStore.snapshot().baseUrl,
        sessionToken: signedIn.sessionToken,
        userId: signedIn.userId,
        displayName: signedIn.displayName,
        expiresAt: signedIn.expiresAt,
      })
      return { ok: true, value: state }
    } catch (err) {
      return {
        ok: false,
        error: {
          code: (err as { code?: string }).code ?? 'unknown',
          message: err instanceof Error ? err.message : String(err),
        },
      }
    }
  }

  async function handleSignIn(
    _event: Electron.IpcMainInvokeEvent,
    raw: unknown,
  ): Promise<{ ok: true; value: AuthState } | { ok: false; error: { code: string; message: string } }> {
    const parsed = SignInInputSchema.safeParse(raw)
    if (!parsed.success) {
      return { ok: false, error: { code: 'INVALID_INPUT', message: parsed.error.message } }
    }
    try {
      const signedIn = await deps.apiClient.call<{
        userId: string
        displayName: string | null
        sessionToken: string
        expiresAt: number
      }>('account.signin', parsed.data)
      const state = await installSession({
        baseUrl: deps.credentialStore.snapshot().baseUrl,
        sessionToken: signedIn.sessionToken,
        userId: signedIn.userId,
        displayName: signedIn.displayName,
        expiresAt: signedIn.expiresAt,
      })
      return { ok: true, value: state }
    } catch (err) {
      return {
        ok: false,
        error: {
          code: (err as { code?: string }).code ?? 'unknown',
          message: err instanceof Error ? err.message : String(err),
        },
      }
    }
  }

  async function handleSignOut(): Promise<{ ok: true; value: AuthState }> {
    const token = deps.apiClient.getToken()
    if (token !== null) {
      // Best-effort: a network failure here must not strand the user in a
      // half-cleared state. The host treats unknown session tokens as
      // already-revoked (idempotent), so the next signin reissues a token.
      try {
        await deps.apiClient.call('account.signout', { sessionToken: token })
      } catch {
        // ignore — we still clear local state.
      }
    }
    const state = await clearSession()
    return { ok: true, value: state }
  }

  function install(): void {
    ipcMain.handle(IpcChannels.Request, handleRequest)
    ipcMain.handle(IpcChannels.ImportDirectory, handleImportDirectory)
    ipcMain.handle(IpcChannels.Respond, handleRespond)
    ipcMain.handle(IpcChannels.GetSession, handleGetSession)
    ipcMain.handle(IpcChannels.UpdateSession, handleUpdateSession)
    ipcMain.handle(IpcChannels.SubscribeMux, handleSubscribeMux)
    ipcMain.handle(IpcChannels.UnsubscribeMux, handleUnsubscribeMux)
    ipcMain.handle(IpcChannels.SubscribeHost, handleSubscribeHost)
    ipcMain.handle(IpcChannels.UnsubscribeHost, handleUnsubscribeHost)
    ipcMain.handle(IpcChannels.GetAppUpdateState, handleGetAppUpdateState)
    ipcMain.handle(IpcChannels.CheckAppUpdate, handleCheckAppUpdate)
    ipcMain.handle(IpcChannels.OpenAppUpdateDownload, handleOpenAppUpdateDownload)
    ipcMain.handle(IpcChannels.SaveArtifact, handleSaveArtifact)
    ipcMain.handle(IpcChannels.OpenArtifactInBrowser, handleOpenArtifactInBrowser)
    ipcMain.handle(IpcChannels.ListSkills, handleListSkills)
    ipcMain.handle(IpcChannels.InstallSkill, handleInstallSkill)
    ipcMain.handle(IpcChannels.GetAuthState, handleGetAuthState)
    ipcMain.handle(IpcChannels.RequestEmailCode, handleRequestEmailCode)
    ipcMain.handle(IpcChannels.SignUp, handleSignUp)
    ipcMain.handle(IpcChannels.SignIn, handleSignIn)
    ipcMain.handle(IpcChannels.SignOut, handleSignOut)
  }

  function uninstall(): void {
    ipcMain.removeHandler(IpcChannels.Request)
    ipcMain.removeHandler(IpcChannels.ImportDirectory)
    ipcMain.removeHandler(IpcChannels.Respond)
    ipcMain.removeHandler(IpcChannels.GetSession)
    ipcMain.removeHandler(IpcChannels.UpdateSession)
    ipcMain.removeHandler(IpcChannels.SubscribeMux)
    ipcMain.removeHandler(IpcChannels.UnsubscribeMux)
    ipcMain.removeHandler(IpcChannels.SubscribeHost)
    ipcMain.removeHandler(IpcChannels.UnsubscribeHost)
    ipcMain.removeHandler(IpcChannels.GetAppUpdateState)
    ipcMain.removeHandler(IpcChannels.CheckAppUpdate)
    ipcMain.removeHandler(IpcChannels.OpenAppUpdateDownload)
    ipcMain.removeHandler(IpcChannels.SaveArtifact)
    ipcMain.removeHandler(IpcChannels.OpenArtifactInBrowser)
    ipcMain.removeHandler(IpcChannels.ListSkills)
    ipcMain.removeHandler(IpcChannels.InstallSkill)
    ipcMain.removeHandler(IpcChannels.GetAuthState)
    ipcMain.removeHandler(IpcChannels.RequestEmailCode)
    ipcMain.removeHandler(IpcChannels.SignUp)
    ipcMain.removeHandler(IpcChannels.SignIn)
    ipcMain.removeHandler(IpcChannels.SignOut)
    if (mux) {
      mux.controller.abort()
      void mux.task.catch(() => undefined)
      mux = null
    }
    if (host) {
      host.controller.abort()
      void host.task.catch(() => undefined)
      host = null
    }
  }

  return { install, uninstall }
}

/**
 * Lock down `webContents.openWindow` and `will-navigate` on the main window —
 * the renderer can never navigate the BrowserWindow to a remote origin, and
 * `window.open` is denied. The dsh-ops backend stays on loopback (or its
 * nginx public fronting) per the `trustedHosts` fence.
 */
export function installSecurityGuards(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault()
  })
  win.webContents.on('will-attach-webview', (event) =>{  event.preventDefault() })
}

// MuxFrame / HostFrame type re-exports for downstream consumers.
export type { MuxFrame, HostFrame }
