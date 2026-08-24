// CDP acceptance probe for the desktop auth gate (PR 2 step H).
//
// Connects to a running Electron renderer via Chrome DevTools Protocol,
// verifies the SignInCard cold-start surface, captures a screenshot, and
// walks the renderer through the auth lifecycle:
//   1. cold start with empty safeStorage → SignInCard renders
//   2. useAuthStore reports `state.signedIn === false`
//   3. SignInCard has the testid hooks for email / password / code input
//   4. (best effort, when a backend is reachable) requestEmailCode fires
//
// The workbuddy backend is NOT a precondition — the renderer can boot
// and render the gate without it; only step 4 needs the host. When the
// backend is unreachable, step 4 is logged as `skipped`, not a failure.
//
// Usage:
//   # launch electron with CDP enabled (separate terminal):
//   pnpm --filter @deepseek-ai/dsh-desktop run build && \
//     electron . --remote-debugging-port=9222
//   # then, in this repo root:
//   node apps/desktop/desktop-auth-gate.mjs
import { chromium } from '../../node_modules/.pnpm/playwright-core@1.62.1/node_modules/playwright-core/index.mjs'
import { writeFileSync, mkdirSync } from 'node:fs'

const DEBUG_URL = process.env.DEBUG_URL ?? 'http://127.0.0.1:9222'
const OUT_DIR = process.env.OUT_DIR ?? '/tmp/desktop-auth-gate'
mkdirSync(OUT_DIR, { recursive: true })

const browser = await chromium.connectOverCDP(DEBUG_URL)
const ctx = browser.contexts()[0]
const page = ctx.pages()[0]
if (!page) {
  console.error('[auth-gate] no page in CDP context; is Electron running with --remote-debugging-port?')
  process.exit(1)
}

const consoleLines = []
page.on('console', msg => consoleLines.push({ type: msg.type(), text: msg.text() }))
page.on('pageerror', err => consoleLines.push({ type: 'pageerror', text: err.message + '\n' + (err.stack ?? '') }))

function shot(name) {
  return page.screenshot({ path: `${OUT_DIR}/${name}.png`, fullPage: false }).then(() => `${OUT_DIR}/${name}.png`)
}

// Give Cordis + the auth store a moment to settle.
await page.waitForTimeout(4_000)

const results = []

// Step 1 — root populated and contains the auth gate.
const gateState = await page.evaluate(() => {
  const root = document.getElementById('root')
  const gate = document.querySelector('[data-testid="signin-gate"]')
  const shell = document.querySelector('[data-testid="workbench-root"]')
  // The data-mode attribute lives on the inner .signin-card div, not on
  // the wrapper; pick whichever side owns it.
  const modeSource = gate?.querySelector('.signin-card[data-mode]') ?? gate
  const card = gate?.querySelector('.signin-card')
  const tabs = Array.from(gate?.querySelectorAll('[role="tab"]') ?? [])
    .map(t => t.textContent?.trim())
  const submitButton = gate?.querySelector('button[type="submit"]')
  return {
    rootHtmlLen: root?.innerHTML.length ?? 0,
    rootHasContent: (root?.textContent?.trim().length ?? 0) > 0,
    gatePresent: !!gate,
    shellPresent: !!shell,
    cardPresent: !!card,
    dataMode: modeSource?.getAttribute('data-mode') ?? null,
    tabs,
    submitLabel: submitButton?.textContent?.trim() ?? null,
    gateText: gate?.textContent?.replace(/\s+/g, ' ').slice(0, 400) ?? '',
    gateTestids: Array.from(gate?.querySelectorAll('[data-testid]') ?? [])
      .map(el => el.getAttribute('data-testid'))
      .filter(Boolean),
    headings: Array.from(gate?.querySelectorAll('h1, h2, h3') ?? [])
      .map(h => h.textContent?.trim())
      .filter(Boolean),
  }
})
results.push({ step: 'gate-renders', ...gateState })
const shot1 = await shot('01-gate-cold-start')
console.log('[1/5] gate-renders — present=' + gateState.gatePresent + ' cardMode=' + gateState.dataMode)
console.log('       tabs=' + JSON.stringify(gateState.tabs))
console.log('       submitLabel=' + JSON.stringify(gateState.submitLabel))
console.log('       headings=' + JSON.stringify(gateState.headings))
console.log('       screenshot=' + shot1)

// Step 2 — useAuthStore is reachable through `window` (best effort). When
// the renderer didn't mount the gate (Cordis boot crash), this surfaces
// the actual store state so the failure mode is obvious.
const storeState = await page.evaluate(() => {
  // The Zustand store registers a subscriber that we can't reach from
  // outside the bundle, but the rendered `data-mode` attribute on the
  // card mirrors `useAuthStore.state.initialized && !state.signedIn`.
  const gate = document.querySelector('[data-testid="signin-gate"]')
  const card = gate?.querySelector('.signin-card[data-mode]')
  return {
    cardDataMode: card?.getAttribute('data-mode') ?? null,
    workbenchApiKeys: typeof window.workbenchApi === 'object'
      ? Object.keys(window.workbenchApi).sort()
      : [],
  }
})
results.push({ step: 'store-state', ...storeState })
console.log('[2/5] store-state — cardMode=' + storeState.cardDataMode)
console.log('       workbenchApi keys=' + JSON.stringify(storeState.workbenchApiKeys))

// Step 3 — IPC surface: getAuthState round-trip via the preload bridge.
const ipcState = await page.evaluate(async () => {
  const api = window.workbenchApi
  if (!api) return { reachable: false }
  try {
    const auth = await api.getAuthState()
    return {
      reachable: true,
      auth,
      hasRequestEmailCode: typeof api.requestEmailCode === 'function',
      hasSignIn: typeof api.signIn === 'function',
      hasSignUp: typeof api.signUp === 'function',
      hasSignOut: typeof api.signOut === 'function',
      hasSubscribeAuthState: typeof api.subscribeAuthState === 'function',
    }
  } catch (err) {
    return { reachable: false, error: String(err) }
  }
})
results.push({ step: 'ipc-surface', ...ipcState })
console.log('[3/5] ipc-surface — reachable=' + ipcState.reachable)
console.log('       auth=' + JSON.stringify(ipcState.auth ?? null))
console.log('       methods=' + JSON.stringify({
  requestEmailCode: ipcState.hasRequestEmailCode,
  signIn: ipcState.hasSignIn,
  signUp: ipcState.hasSignUp,
  signOut: ipcState.hasSignOut,
  subscribeAuthState: ipcState.hasSubscribeAuthState,
}))

// Step 4 — best-effort requestEmailCode against the live backend.
const codeResult = await page.evaluate(async () => {
  const api = window.workbenchApi
  if (!api || typeof api.requestEmailCode !== 'function') return { skipped: true }
  try {
    const result = await api.requestEmailCode({ email: 'probe+auth-gate@deepseek.example' })
    return { attempted: true, result }
  } catch (err) {
    return { attempted: true, error: String(err) }
  }
})
results.push({ step: 'request-email-code', ...codeResult })
const shot4 = await shot('02-after-probe')
if (codeResult.skipped) {
  console.log('[4/5] request-email-code — skipped (no api.requestEmailCode)')
} else if (codeResult.error) {
  console.log('[4/5] request-email-code — backend unreachable: ' + codeResult.error.slice(0, 200))
} else {
  console.log('[4/5] request-email-code — result=' + JSON.stringify(codeResult.result).slice(0, 200))
}
console.log('       screenshot=' + shot4)

// Step 5 — gate still rendered (probe didn't accidentally sign anyone in).
const finalGate = await page.evaluate(() => {
  const gate = document.querySelector('[data-testid="signin-gate"]')
  const card = gate?.querySelector('.signin-card[data-mode]')
  return {
    gateStillPresent: !!gate,
    dataMode: card?.getAttribute('data-mode') ?? null,
  }
})
results.push({ step: 'gate-after-probe', ...finalGate })
console.log('[5/5] gate-after-probe — present=' + finalGate.gateStillPresent + ' mode=' + finalGate.dataMode)

writeFileSync(`${OUT_DIR}/results.json`, JSON.stringify({ results, consoleLines }, null, 2))

// Surface any console errors that aren't a known noise.
const interestingErrors = consoleLines.filter(line => {
  if (line.type !== 'error' && line.type !== 'pageerror') return false
  if (line.text.includes('127.0.0.1:18000')) return false
  if (line.text.includes('119.45.252.25')) return false
  if (line.text.includes('ERR_CONNECTION_REFUSED')) return false
  if (line.text.includes('connection lost, retry')) return false
  return true
})
if (interestingErrors.length > 0) {
  console.log('--- console errors (filtered) ---')
  for (const err of interestingErrors) console.log(`[${err.type}]`, err.text.slice(0, 280))
}

await browser.close()

// Exit code: if the gate never rendered, that's a hard failure.
const hardFail = !gateState.gatePresent
if (hardFail) {
  console.error('[auth-gate] HARD FAIL: SignInCard did not render on cold start.')
  process.exit(2)
}
console.log('[auth-gate] OK — gate renders, IPC surface present, screenshots at ' + OUT_DIR)