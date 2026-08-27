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
 * Authentication is an account feature inside the complete Cordis UI. It
 * does not gate local workspaces or replace the renderer on sign-in/out.
 */
import { bootRenderer, type HostHandles } from './cordis-host'
import type { WorkbenchApiTransport } from './transport'
import { installPersistedTheme } from './theme-persist'
import { buildDevBridge } from './dev-bridge'
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
// oxlint-disable-next-line typescript/no-unnecessary-condition
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
const api = rawApi as unknown as WorkbenchApiTransport

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

async function disposeCordis(): Promise<void> {
  if (cordisHandles) {
    const handles = cordisHandles
    cordisHandles = null
    await handles.dispose().catch((err: unknown) => {
      console.error('[desktop-renderer] cordis dispose threw:', err)
    })
  }
}

async function showXiaowei(): Promise<void> {
  await disposeCordis()
  try {
    // Sampled per boot: the directory-flow surface choice (native vs browse)
    // reads it; a baseUrl edit in Settings takes effect on the next boot.
    const { baseUrl } = await rawApi.getSession()
    cordisHandles = await bootRenderer(container, api, baseUrl)
  } catch (err) {
    console.error('[desktop-renderer] runtime boot failed:', err)
    const host = document.createElement('div')
    host.className = 'runtime-error'
    host.setAttribute('data-testid', 'local-runtime-error')
    host.innerHTML = '<h1>本机运行环境不可用</h1><p>请重试本机运行环境，或在设置中切换到云端。</p>'
    container.appendChild(host)
  }
}

await bindAuthStore()
// Restore the durable account before sidebar chrome reads its initial identity.
await useAuthStore.getState().refresh()
useAuthStore.subscribe((state, prev) => {
  if (!state.initialized) return
  const currentKey = state.state.signedIn ? `signed-in:${state.state.userId}` : 'signed-out'
  const previousKey = prev.state.signedIn ? `signed-in:${prev.state.userId}` : 'signed-out'
  if (currentKey === previousKey) return
  // Authentication affects cloud RPC authorization only. The complete UI and
  // local Host remain mounted for signed-out users.
})

await showXiaowei()

// ---- Lifecycle ---------------------------------------------------------

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    void disposeCordis()
  })
}

window.addEventListener('beforeunload', () => {
  void disposeCordis()
})
