/**
 * Typed ipcMain handlers.
 *
 * Slim surface for the dsh-ops backed Electron client:
 *  - `Request` → generic RPC bridge (renderer→main→dsh-ops `POST /api/<method>`).
 *  - `Respond` → POST `/api/respond` with a ClientResponse envelope.
 *  - `SubscribeMux` / `UnsubscribeMux` → open / tear down the SSE carrier
 *    GET /api/events.mux and fan frames out as `MuxEvent` IPC events.
 *  - `SubscribeHost` / `UnsubscribeHost` → the same for GET /api/events.host.
 *  - `GetSession` / `UpdateSession` → settings persistence (baseUrl only).
 *  - `GetAppUpdateState` / `CheckAppUpdate` / `OpenAppUpdateDownload` →
 *    forwarded to the (stubbed) UpdateChecker; the IPC channel remains so
 *    the renderer can keep its "check for updates" affordance.
 *
 * The renderer never holds raw `ipcRenderer`; the preload exposes only
 * `WORKBENCH_API_KEYS`.
 */
import { BrowserWindow, ipcMain, type WebContents } from 'electron'
import { z } from 'zod'
import {
  ClientResponseSchema,
  IpcChannels,
  MuxFrameSchema,
  HostFrameSchema,
  SessionStateSchema,
  type HostFrame,
  type MuxFrame,
} from '../shared/contracts'
import { ApiClient } from './api-client'
import { CredentialStore } from './credential-store'
import type { UpdateChecker } from './update-checker'

interface HandlersDeps {
  apiClient: ApiClient
  credentialStore: CredentialStore
  baseUrl: () => string
  updateChecker: () => UpdateChecker
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
      const value = await deps.apiClient.call(parsed.data.method, parsed.data.payload)
      return { ok: true, value }
    } catch (err) {
      const code = (err as { code?: string }).code ?? 'unknown'
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, error: { code, message } }
    }
  }

  async function handleRespond(_event: Electron.IpcMainInvokeEvent, raw: unknown): Promise<void> {
    const parsed = ClientResponseSchema.safeParse(raw)
    if (!parsed.success) {
      throw new Error(`invalid ClientResponse envelope: ${parsed.error.message}`)
    }
    await deps.apiClient.respond(parsed.data)
  }

  async function handleGetSession(): Promise<{ baseUrl: string }> {
    const snapshot = deps.credentialStore.snapshot()
    return SessionStateSchema.parse({ baseUrl: snapshot.baseUrl })
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
      await deps.credentialStore.save({ baseUrl: parsed.data.baseUrl })
      deps.apiClient.setBaseUrl(parsed.data.baseUrl)
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
      } catch (err) {
        if (controller.signal.aborted) return
        if (wc.isDestroyed()) return
        wc.send(eventName, {
          rpcId: '',
          method: 'stream/error',
          payload: {
            type: 'stream/error',
            error: {
              code: (err as { code?: string }).code ?? 'internal',
              message: err instanceof Error ? err.message : String(err),
            },
          },
        })
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
        signal => deps.apiClient.streamMux(signal) as AsyncIterable<unknown>,
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
        signal => deps.apiClient.streamHost(signal) as AsyncIterable<unknown>,
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

  async function handleOpenAppUpdateDownload(): Promise<{ ok: false; error: { code: string; message: string } }> {
    try {
      await deps.updateChecker().openDownload()
      return { ok: false, error: { code: 'no-update', message: 'no update available' } }
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

  function install(): void {
    ipcMain.handle(IpcChannels.Request, handleRequest)
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
  }

  function uninstall(): void {
    ipcMain.removeHandler(IpcChannels.Request)
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
  win.webContents.on('will-attach-webview', event => event.preventDefault())
}

// MuxFrame / HostFrame type re-exports for downstream consumers.
export type { MuxFrame, HostFrame }
