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
 * Auth gate (10.1a): until the user is signed in, the Cordis UI is
 * replaced by `<SignInCard />` mounted into a `.signin-gate` overlay.
 * Once `useAuthStore.state.signedIn` flips true, the overlay is torn
 * down and the Cordis host is booted; on sign-out the reverse happens.
 * The auth store is subscribed once at boot; IPC fan-out from the main
 * process keeps the gate in sync across windows.
 */
import React, { StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { bootRenderer, type HostHandles } from './cordis-host'
import { installTransport, type WorkbenchApiTransport } from './transport'
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
if (!rawApi) {
  if (window.__WORKBENCH_API_OVERRIDE__) {
    rawApi = window.__WORKBENCH_API_OVERRIDE__
  } else {
    // Vite dev server has no preload script. Install a dev bridge that
    // talks to the backend via fetch / EventSource so the rest of the
    // UI is exercisable end-to-end from the browser.
    rawApi = buildDevBridge()
  }
  window.workbenchApi = rawApi as unknown as typeof window.workbenchApi
}
const api = rawApi as unknown as WorkbenchApiTransport

installPersistedTheme()
installTransport(api)

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

// ---- Auth gate ---------------------------------------------------------
//
// We hold one of two mutually exclusive mounts at a time: a `.signin-gate`
// React root (SignInCard only) OR the Cordis host. Disposing one before
// mounting the other keeps #root's children unambiguous — we never have a
// partial overlay fighting the slot tree for input events.

let cordisHandles: HostHandles | null = null
let signinRoot: Root | null = null
let signinHost: HTMLDivElement | null = null

function disposeCordis(): void {
  if (cordisHandles) {
    void cordisHandles.dispose().catch((err) => {
      console.error('[desktop-renderer] cordis dispose threw:', err)
    })
    cordisHandles = null
  }
}

function unmountSignIn(): void {
  if (signinRoot) {
    signinRoot.unmount()
    signinRoot = null
  }
  if (signinHost) {
    signinHost.remove()
    signinHost = null
  }
}

async function showSignInGate(): Promise<void> {
  disposeCordis()
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

async function showWorkbuddy(): Promise<void> {
  unmountSignIn()
  disposeCordis()
  try {
    // Sampled per boot: the directory-flow surface choice (native vs browse)
    // reads it; a baseUrl edit in Settings takes effect on the next boot.
    const { baseUrl } = await rawApi.getSession()
    cordisHandles = await bootRenderer(container, api, baseUrl)
  } catch (err) {
    console.error('[desktop-renderer] cordis boot failed; falling back to sign-in:', err)
    await showSignInGate()
  }
}

await bindAuthStore()

useAuthStore.subscribe((state, prev) => {
  if (!state.initialized) return
  if (state.state.signedIn === prev.state.signedIn) return
  if (state.state.signedIn) {
    void showWorkbuddy()
  } else {
    void showSignInGate()
  }
})

const initial = useAuthStore.getState()
if (initial.initialized && initial.state.signedIn) {
  await showWorkbuddy()
} else {
  await showSignInGate()
}

// ---- Lifecycle ---------------------------------------------------------

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    disposeCordis()
    unmountSignIn()
  })
}

window.addEventListener('beforeunload', () => {
  disposeCordis()
  unmountSignIn()
})
