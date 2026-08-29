/**
 * Renderer entrypoint.
 *
 * Replaces the legacy `app.tsx` (HashRouter + 6-page Router shell) with
 * a Cordis-driven mount: the connection / runtime / locale / theme /
 * layout / sidebar / workspace / conversation / settings plugins form
 * the slot tree, and `ctx.uiRenderer.mount(#root)` renders it.
 *
 * URL hash still drives workspace / session navigation; the read is
 * handled by webUI's `ui-workspace` slot occupant (which reads
 * `location.hash` and dispatches into `ctx.workspaces.select` /
 * `ctx.sessions.open`).
 *
 * Authentication owns the renderer entry. Signed-out users see only the
 * account page; the Cordis workbench is mounted only after sign-in and is
 * disposed before the signed-out page returns.
 */
import React, { StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { bootRenderer, type DesktopWorkbenchApi, type HostHandles } from './cordis-host'
import { installPersistedTheme } from './theme-persist'
import { buildDevBridge } from './dev-bridge'
import { SignInCard } from './features/auth/SignInCard'
import { useAuthStore, bindAuthStore } from './stores/auth'
import './styles.css'

// `window.workbenchApi` is augmented in `apps/desktop/src/renderer/api.ts`.
// The packaged app loads the preload script (see `src/preload/index.ts`)
// which installs it. The Vite dev server has no preload, so the renderer
// installs the dev bridge stub.
//
// The `api.ts` augmentation declares `WorkbenchApi & { ... }` — a
// superset of the four-method subset we actually consume. We narrow
// via structural cast here; runtime calls only hit the four primitives.
let rawApi = window.workbenchApi
// Preload makes this required in packaged builds; the Vite dev runtime starts without it.
if (!rawApi) {
  if (window.__WORKBENCH_API_OVERRIDE__) {
    rawApi = window.__WORKBENCH_API_OVERRIDE__
  } else {
    // Vite dev server has no preload script. Install a dev bridge that
    // talks to the backend via fetch / EventSource so the rest of the
    // UI is exercisable end-to-end from the browser.
    rawApi = buildDevBridge()
  }
  window.workbenchApi = rawApi
}
const api = rawApi as unknown as DesktopWorkbenchApi

installPersistedTheme()

const containerRaw = document.getElementById('root')
if (!containerRaw) throw new Error('desktop renderer: missing #root')
// Capture the asserted non-null root in a `const` so closures that survive
// across `await` boundaries keep the narrowed `HTMLElement` type (TS loses
// narrowing on captured `let`/reassigned locals across async boundaries).
const container: HTMLDivElement = containerRaw as HTMLDivElement

// macOS builds run with a hiddenInset titlebar; flag the platform so
// the stylesheet can clear the traffic-light buttons in the sidebar.
if (/Mac OS X|Macintosh/.test(navigator.userAgent)) {
  document.body.classList.add('is-mac')
}

let cordisHandles: HostHandles | null = null
let signinRoot: Root | null = null
let signinHost: HTMLDivElement | null = null
let runtimeErrorHost: HTMLDivElement | null = null
let desiredAuthKey = 'uninitialized'
let surfaceTransition = Promise.resolve()

async function disposeCordis(): Promise<void> {
  if (cordisHandles) {
    const handles = cordisHandles
    cordisHandles = null
    await handles.dispose().catch((err: unknown) => {
      console.error('[desktop-renderer] cordis dispose threw:', err)
    })
  }
}

function unmountSignIn(): void {
  if (signinRoot) {
    signinRoot.unmount()
    signinRoot = null
  }
  signinHost?.remove()
  signinHost = null
}

function clearRuntimeError(): void {
  runtimeErrorHost?.remove()
  runtimeErrorHost = null
}

async function showSignInGate(): Promise<void> {
  await disposeCordis()
  clearRuntimeError()
  unmountSignIn()
  const host = document.createElement('div')
  host.className = 'signin-gate'
  host.setAttribute('data-testid', 'signin-gate')
  container.appendChild(host)
  signinHost = host
  signinRoot = createRoot(host)
  signinRoot.render(
    React.createElement(StrictMode, null, React.createElement(SignInCard)),
  )
}

async function showXiaowei(expectedAuthKey: string): Promise<void> {
  unmountSignIn()
  clearRuntimeError()
  await disposeCordis()
  if (desiredAuthKey !== expectedAuthKey) return
  try {
    // Sampled per boot: the directory-flow surface choice (native vs browse)
    // reads it; a baseUrl edit in Settings takes effect on the next boot.
    const { baseUrl } = await rawApi.getSession()
    if (desiredAuthKey !== expectedAuthKey) return
    const handles = await bootRenderer(container, api, baseUrl)
    if (desiredAuthKey !== expectedAuthKey) {
      await handles.dispose()
      return
    }
    cordisHandles = handles
  } catch (err) {
    if (desiredAuthKey !== expectedAuthKey) return
    console.error('[desktop-renderer] runtime boot failed:', err)
    const host = document.createElement('div')
    host.className = 'runtime-error'
    host.setAttribute('data-testid', 'local-runtime-error')
    host.innerHTML = '<h1>本机运行环境不可用</h1><p>请重试本机运行环境，或在设置中切换到云端。</p>'
    container.appendChild(host)
    runtimeErrorHost = host
  }
}

function authKey(state: ReturnType<typeof useAuthStore.getState>['state']): string {
  return state.signedIn ? `signed-in:${state.userId}` : 'signed-out'
}

function scheduleAuthSurface(state: ReturnType<typeof useAuthStore.getState>['state']): Promise<void> {
  const nextAuthKey = authKey(state)
  desiredAuthKey = nextAuthKey
  surfaceTransition = surfaceTransition
    .catch((err: unknown) => {
      console.error('[desktop-renderer] auth surface transition threw:', err)
    })
    .then(async () => {
      if (desiredAuthKey !== nextAuthKey) return
      if (state.signedIn) {
        await showXiaowei(nextAuthKey)
      } else {
        await showSignInGate()
      }
    })
  return surfaceTransition
}

let unbindAuthStore = (): void => undefined
try {
  unbindAuthStore = await bindAuthStore()
} catch (err) {
  console.error('[desktop-renderer] auth broadcast subscription failed:', err)
}
// Restore the durable account before deciding whether any workspace UI may mount.
await useAuthStore.getState().refresh()
const unsubscribeAuthStore = useAuthStore.subscribe((state, prev) => {
  if (!state.initialized) return
  const currentKey = authKey(state.state)
  const previousKey = authKey(prev.state)
  if (currentKey === previousKey) return
  void scheduleAuthSurface(state.state)
})

await scheduleAuthSurface(useAuthStore.getState().state)

async function disposeRenderer(): Promise<void> {
  desiredAuthKey = 'disposed'
  unsubscribeAuthStore()
  unbindAuthStore()
  await surfaceTransition
  await disposeCordis()
  unmountSignIn()
  clearRuntimeError()
}

// ---- Lifecycle ---------------------------------------------------------

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    void disposeRenderer()
  })
}

window.addEventListener('beforeunload', () => {
  void disposeRenderer()
})
