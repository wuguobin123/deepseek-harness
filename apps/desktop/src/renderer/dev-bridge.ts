/**
 * Dev bridge — Vite dev server has no Electron preload, so this module
 * exposes a stand-in `window.workbenchApi` that talks to dsh-ops over plain
 * fetch + EventSource. The packaged app never reaches this code: the
 * preload bridge always wins when present.
 *
 * Trust: the loopback fence (`dsh-client-connection.trustedHosts`) accepts
 * the same origin the Vite dev server is configured against, which the
 * `.env.development` `VITE_DEFAULT_SERVICE_URL` points at.
 */
import type { WorkbenchApi } from '../preload/index'
import type {
  ClientResponse,
  HostFrame,
  MuxFrame,
  SessionState,
} from '../shared/contracts'

const DEFAULT_BASE_URL = (import.meta.env?.VITE_DEFAULT_SERVICE_URL as string | undefined) ?? 'http://127.0.0.1:18000'

function getBaseUrl(): string {
  return (window as unknown as { __DSH_BASE_URL__?: string }).__DSH_BASE_URL__ ?? DEFAULT_BASE_URL
}

interface WorkbenchApiWithExtras extends WorkbenchApi {
  setBaseUrl: (url: string) => void
}

function baseHeaders(extra?: Record<string, string>): Record<string, string> {
  return { 'content-type': 'application/json', ...(extra ?? {}) }
}

export function buildDevBridge(): WorkbenchApiWithExtras {
  let baseUrl = getBaseUrl()

  async function request<R>(method: string, payload: unknown): Promise<{ ok: true; value: R } | { ok: false; error: { code: string; message: string } }> {
    const url = `${baseUrl}/api/${method}`
    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: baseHeaders(),
        body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method, payload }),
      })
    } catch (err) {
      return { ok: false, error: { code: 'NETWORK_ERROR', message: String(err) } }
    }
    const text = await response.text()
    let parsed: unknown = null
    if (text) {
      try {
        parsed = JSON.parse(text)
      } catch {
        return { ok: false, error: { code: `HTTP_${response.status}`, message: text } }
      }
    }
    if (!response.ok) {
      return { ok: false, error: { code: `HTTP_${response.status}`, message: text } }
    }
    return parsed as { ok: true; value: R } | { ok: false; error: { code: string; message: string } }
  }

  function streamSse(path: string): EventSource {
    return new EventSource(`${baseUrl}${path}`)
  }

  return {
    setBaseUrl(url: string) {
      baseUrl = url
    },

    request<R = unknown>(method: string, payload: unknown): Promise<{ ok: true; value: R } | { ok: false; error: { code: string; message: string } }> {
      return request<R>(method, payload)
    },

    async subscribeMux(listener: (envelope: { rpcId: string; method: string; payload: MuxFrame }) => void): Promise<() => Promise<void>> {
      const source = streamSse('/api/events.mux')
      const handler = (event: MessageEvent) => {
        try {
          const envelope = JSON.parse(event.data) as { rpcId: string; method: string; payload: MuxFrame }
          listener(envelope)
        } catch {
          // ignore non-JSON keepalive lines
        }
      }
      source.addEventListener('message', handler)
      return async () => {
        source.removeEventListener('message', handler)
        source.close()
      }
    },

    async subscribeHost(listener: (envelope: { rpcId: string; method: string; payload: HostFrame }) => void): Promise<() => Promise<void>> {
      const source = streamSse('/api/events.host')
      const handler = (event: MessageEvent) => {
        try {
          const envelope = JSON.parse(event.data) as { rpcId: string; method: string; payload: HostFrame }
          listener(envelope)
        } catch {
          // ignore
        }
      }
      source.addEventListener('message', handler)
      return async () => {
        source.removeEventListener('message', handler)
        source.close()
      }
    },

    async respond(rpcId: string, value: unknown, error?: { code: string; message: string; details?: Record<string, unknown> }): Promise<void> {
      const envelope: ClientResponse = error
        ? { type: 'client-response', rpcId, result: { ok: false, error: { code: error.code, message: error.message, details: error.details ?? {} } } }
        : { type: 'client-response', rpcId, result: { ok: true, value } }
      await fetch(`${baseUrl}/api/respond`, {
        method: 'POST',
        headers: baseHeaders(),
        body: JSON.stringify(envelope),
      })
    },

    async getSession(): Promise<SessionState> {
      return { baseUrl, version: '2' }
    },

    async updateSession(input: { baseUrl: string }): Promise<{ ok: true; value: { baseUrl: string } } | { ok: false; error: { code: string; message: string } }> {
      baseUrl = input.baseUrl
      return { ok: true, value: { baseUrl } }
    },

    async getAppUpdateState() {
      return { status: 'up-to-date' as const, currentVersion: '0.3.0' }
    },

    async checkAppUpdate() {
      return { status: 'up-to-date' as const, currentVersion: '0.3.0' }
    },

    async openAppUpdateDownload() {
      throw new Error('no update available')
    },

    async subscribeAppUpdateState(listener: (state: { status: 'up-to-date'; currentVersion: string }) => void) {
      listener({ status: 'up-to-date', currentVersion: '0.3.0' })
      return () => undefined
    },
  }
}
