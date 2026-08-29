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
  AuthState,
  ClientResponse,
  HostFrame,
  InstalledSkillRecord,
  MuxFrame,
  RequestEmailCodeValue,
  SessionState,
  SkillDirectoryInstallResult,
} from '../shared/contracts'
import { withArtifactCsp } from '../shared/artifact-html'

const DEFAULT_BASE_URL = (import.meta.env.VITE_DEFAULT_SERVICE_URL as string | undefined) ?? 'http://127.0.0.1:18000'

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

  // The caller selects R from the RPC method; payload does not carry the response type.
  async function request<R>(
    method: string,
    payload: unknown,
  ): Promise<{ ok: true; value: R } | { ok: false; error: { code: string; message: string } }> {
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

    // Implements WorkbenchApi's caller-selected RPC result type.
    request<R = unknown>(
      method: string,
      payload: unknown,
    ): Promise<{ ok: true; value: R } | { ok: false; error: { code: string; message: string } }> {
      return request<R>(method, payload)
    },

    importDirectory() {
      return request('workspace.importDirectory', {})
    },

    subscribeMux(listener: (envelope: { rpcId: string; method: string; payload: MuxFrame }) => void): Promise<() => Promise<void>> {
      const source = streamSse('/api/events.mux')
      const handler = (event: MessageEvent<unknown>) => {
        if (typeof event.data !== 'string') return
        try {
          const envelope = JSON.parse(event.data) as { rpcId: string; method: string; payload: MuxFrame }
          listener(envelope)
        } catch {
          // ignore non-JSON keepalive lines
        }
      }
      source.addEventListener('message', handler)
      return Promise.resolve(() => {
        source.removeEventListener('message', handler)
        source.close()
        return Promise.resolve()
      })
    },

    subscribeHost(listener: (envelope: { rpcId: string; method: string; payload: HostFrame }) => void): Promise<() => Promise<void>> {
      const source = streamSse('/api/events.host')
      const handler = (event: MessageEvent<unknown>) => {
        if (typeof event.data !== 'string') return
        try {
          const envelope = JSON.parse(event.data) as { rpcId: string; method: string; payload: HostFrame }
          listener(envelope)
        } catch {
          // ignore
        }
      }
      source.addEventListener('message', handler)
      return Promise.resolve(() => {
        source.removeEventListener('message', handler)
        source.close()
        return Promise.resolve()
      })
    },

    async respond(
      rpcId: string,
      value: unknown,
      error?: { code: string; message: string; details?: Record<string, unknown> },
    ): Promise<void> {
      const envelope: ClientResponse = error
        ? { type: 'client-response', rpcId, result: { ok: false, error: { code: error.code, message: error.message, details: error.details ?? {} } } }
        : { type: 'client-response', rpcId, result: { ok: true, value } }
      await fetch(`${baseUrl}/api/respond`, {
        method: 'POST',
        headers: baseHeaders(),
        body: JSON.stringify(envelope),
      })
    },

    getSession(): Promise<SessionState> {
      return Promise.resolve({ baseUrl, environment: 'local' as const, lastLocation: 'local' as const, version: '3' })
    },

    updateSession(
      input: { baseUrl: string },
    ): Promise<{ ok: true; value: { baseUrl: string } } | { ok: false; error: { code: string; message: string } }> {
      baseUrl = input.baseUrl
      return Promise.resolve({ ok: true, value: { baseUrl } })
    },

    getAppUpdateState() {
      return Promise.resolve({ status: 'up-to-date' as const, currentVersion: '0.3.0' })
    },

    checkAppUpdate() {
      return Promise.resolve({ status: 'up-to-date' as const, currentVersion: '0.3.0' })
    },

    openAppUpdateDownload() {
      return Promise.reject(new Error('no update available'))
    },

    async saveArtifact(input: { artifactId: string }) {
      const result = await request<{
        view: { name?: string; title?: string; kind: string; mediaType: string }
        bytesBase64: string
      }>('artifact.read', input)
      if (!result.ok) return result
      const binary = atob(result.value.bytesBase64)
      const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
      const name = result.value.view.name ?? result.value.view.title ?? `${result.value.view.kind}-artifact`
      const url = URL.createObjectURL(new Blob([bytes], { type: result.value.view.mediaType }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = name
      anchor.click()
      queueMicrotask(() =>{  URL.revokeObjectURL(url) })
      return { ok: true as const, value: { status: 'saved' as const } }
    },

    async openArtifactInBrowser(input: { artifactId: string }) {
      const preview = window.open('about:blank', '_blank')
      if (preview === null) {
        return { ok: false as const, error: { code: 'POPUP_BLOCKED', message: '浏览器阻止了新标签页' } }
      }
      const result = await request<{ view: { mediaType: string }; bytesBase64: string }>('artifact.read', input)
      if (!result.ok) {
        preview.close()
        return result
      }
      if (result.value.view.mediaType !== 'text/html') {
        preview.close()
        return { ok: false as const, error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: '仅 HTML 产物支持浏览器预览' } }
      }
      const html = new TextDecoder().decode(Uint8Array.from(atob(result.value.bytesBase64), char => char.charCodeAt(0)))
      const url = URL.createObjectURL(new Blob([withArtifactCsp(html)], { type: 'text/html;charset=utf-8' }))
      preview.location.replace(url)
      setTimeout(() =>{  URL.revokeObjectURL(url) }, 30 * 60 * 1000)
      return { ok: true as const, value: { opened: true as const } }
    },

    listSkills(): Promise<{ ok: true; value: readonly InstalledSkillRecord[] } | { ok: false; error: { code: string; message: string } }> {
      return Promise.resolve({
        ok: false,
        error: { code: 'NATIVE_DESKTOP_REQUIRED', message: '本机技能清单仅在小薇桌面客户端中可用' },
      })
    },

    installSkill(): Promise<{ ok: true; value: SkillDirectoryInstallResult | { status: 'cancelled' } } | { ok: false; error: { code: string; message: string } }> {
      return Promise.resolve({
        ok: false,
        error: { code: 'NATIVE_DESKTOP_REQUIRED', message: '安装技能目录需要小薇桌面客户端的原生目录选择器' },
      })
    },

    subscribeAppUpdateState(listener: (state: { status: 'up-to-date'; currentVersion: string }) => void) {
      listener({ status: 'up-to-date', currentVersion: '0.3.0' })
      return Promise.resolve(() => undefined)
    },

    async getAuthState(): Promise<AuthState> {
      const result = await request<AuthState>('account.auth.state', {})
      return result.ok ? result.value : { signedIn: false }
    },
    requestEmailCode(
      input: { email: string },
    ): Promise<{ ok: true; value: RequestEmailCodeValue } | { ok: false; error: { code: string; message: string } }> {
      return request<RequestEmailCodeValue>('account.emailCode', input)
    },
    signUp(
      input: { email: string; password: string; displayName?: string; verificationCode?: string },
    ): Promise<{ ok: true; value: AuthState } | { ok: false; error: { code: string; message: string } }> {
      return request<AuthState>('account.signup', input)
    },
    signIn(
      input: { email: string; password: string },
    ): Promise<{ ok: true; value: AuthState } | { ok: false; error: { code: string; message: string } }> {
      return request<AuthState>('account.signin', input)
    },
    signOut(): Promise<{ ok: true; value: AuthState }> {
      return request<AuthState>('account.signout', {}) as Promise<{ ok: true; value: AuthState }>
    },
    subscribeAuthState(listener: (state: AuthState) => void): Promise<() => void> {
      listener({ signedIn: false })
      return Promise.resolve(() => undefined)
    },
  }
}
