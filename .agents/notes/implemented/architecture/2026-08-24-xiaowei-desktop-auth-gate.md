# Agent Note: Xiaowei desktop renderer entry and auth gate architecture

Status: implemented

English | [中文](2026-08-24-xiaowei-desktop-auth-gate.zh.md)

## Problem

The xiaowei PR 2 stack lands the multi-user backend, the desktop auth IPC bridge, the credential-store v3 token persistence, and the bearer-token ApiClient injection. The renderer entry, however, still pointed `index.html` at the legacy `app.tsx` HashRouter shell — six pages (`HomePanel`, `HistoryPanel`, `AssistantPage`, `SettingsPage`, `ApprovalQueue`, plus the pre-existing `tasks` and `approvals` tab content) plus a `WorkbenchApi`-augmented global. The `main.new.tsx` Cordis-driven entrypoint authored during PR 1 step D — `bootRenderer` + `useAuthStore` + `SignInCard` overlay — was committed to the tree but never actually loaded. Until `index.html` points at it, the xiaowei auth flow has no visible surface: there is no `SignInCard` rendering, no `bindAuthStore` IPC subscription, no Cordis boot on signed-in, and the "auth state broadcast" delivered by the main process reaches a renderer that has not subscribed.

Mounting the complete Cordis renderer while signed out also makes local workspaces usable without an account and leaves logout inside Settings instead of returning to a standalone account page. Xiaowei uses one authenticated product entry for local and cloud workspaces, so the gate owns both cold start and sign-out.

The verification question follows: once the entry switches, how do we prove the gate actually mounts? Vitest covers `CredentialStore` and `ApiClient.setToken`; typecheck covers the `AuthState` discriminated union and the IPC Zod schemas. Neither proves that the renderer boots, that the SignInCard mounts inside `.signin-gate`, or that `getAuthState()` round-trips end-to-end through the preload bridge to a live credential-store read. The existing desktop probes (`desktop-boot-probe.mjs`, `desktop-acceptance.mjs`) attach to an Electron CDP endpoint but probe the legacy app shell. There is no CDP probe that drives the auth-gate contract.

## Decision

Switch the Vite module entry in `apps/desktop/src/renderer/index.html` from `./main.tsx` to `./main.new.tsx`. The legacy `main.tsx` stays in tree so the Vite alias remains valid for ad-hoc dev debugging; the live app loads the Cordis-driven entry.

`main.new.tsx` holds two mutually exclusive mounts at a time — the `.signin-gate` React root (SignInCard only) or the Cordis host — and disposes one before mounting the other. Both share `#root` (an asserted non-null `HTMLDivElement`). Boot attaches `bindAuthStore()` first, calls `refresh()` to read the durable account, and then selects the initial mount. Later auth broadcasts swap the mount when the signed-in user key changes. A workbench boot that completes after sign-out is disposed instead of becoming the current mount. The auth broadcast from main keeps both windows coherent: `IpcChannels.AuthStateEvent` fans to every BrowserWindow's webContents and the Zustand store updates through the subscribed listener.

`container` is captured into a `const: HTMLDivElement` after the non-null assertion rather than left as the result of `document.getElementById('root')` directly. TypeScript loses the non-null narrowing across `await` boundaries inside the closures (`showSignInGate`, `showXiaowei`) because the source binding could in principle be reassigned between awaits. The capture pattern guarantees the narrowed type survives into the async bodies without forcing every closure to re-assert or re-query the DOM. The same `#root` element is reused for both mounts; each mount is responsible for cleaning up before the next.

Acceptance is driven through Chrome DevTools Protocol rather than a synthetic DOM test. `apps/desktop/desktop-auth-gate.mjs` connects to an Electron renderer started with `--remote-debugging-port`, waits four seconds for the auth store to settle, then probes:

1. `[data-testid="signin-gate"]` wraps a `.signin-card[data-mode="signed-out"]` with both Sign-in / Sign-up tabs and the submit button labelled "Sign in"
2. `window.workbenchApi` exposes all 16 bridge keys (10 baseline + 6 auth: `getAuthState`, `requestEmailCode`, `signIn`, `signUp`, `signOut`, `subscribeAuthState`)
3. `api.getAuthState()` round-trips preload → main → `CredentialStore.authState()` and returns `{ signedIn: false }` when safeStorage is empty
4. `api.requestEmailCode({ email })` reaches the main process via IPC; a `HTTP_404` is the expected wire outcome when no xiaowei backend is running on the configured loopback baseUrl — the IPC plumbing is what this step verifies, not the wire payload
5. The gate stays mounted after the probe; no accidental sign-in state mutation

The probe is keyless: it requires Electron + a built dist, not a backend. Steps 1–3 and 5 are pure renderer assertions; step 4 fails loudly when the IPC layer is broken but tolerates a missing backend. This matches the "keyless snapshot" pattern from the testing policy — no `DEEPSEEK_API_KEY` dependency, replays on macOS and Linux identically, asserts visible DOM + bridge surface.

## Alternatives considered

**Inline the SignInCard into the Cordis slot tree instead of a sibling overlay.** The Cordis UI plugins assume a slot-driven layout (sidebar / workspace / conversation / settings), and the SignInCard has its own data flow (read-only `useAuthStore`, no Cordis services consumed). Mounting it as a `ctx.uiRenderer.mount()` component would force it to declare slots it does not need, and any failed Cordis boot would prevent the gate from rendering. The overlay keeps auth fully independent of the host's plugin graph: if Cordis throws during `bootRenderer(container, api, baseUrl)`, the gate falls back in via `catch` and renders the SignInCard normally.

**Probe through a Vitest JSDOM harness.** JSDOM does not implement `BroadcastChannel` for IPC, the Electron `safeStorage` mock requires module-level monkey-patching, and the auth-gate mount touches `document.getElementById('root')` which only exists in a real document. The unit-test surface already covers the credential store and API client directly; the CDP probe covers the things the unit tests cannot — the actual mount, the IPC fan-out subscription, and the renderer state shape after the React commit.

**Use the legacy `app.tsx` entrypoint with an inline `<SignInCard />` route.** The legacy shell is a 6-page HashRouter; auth-gating it would require intercepting every route with a wrapper component and threading the gate through React Router's outlet. The Cordis entry replaces the shell wholesale; a half-rebuilt shell would carry both navigation models and the resulting renderer would not boot under the xiaowei bundle. The clean entry switch wins.

**Run the CDP probe against a real xiaowei backend.** The probe is meant to verify the renderer surface — the DOM mount, the IPC bridge, the auth-state projection. A live backend introduces a second moving part (DSH_HOME, bootstrap config, SMTP transport, identity SQLite WAL) that has its own failure modes. The HTTP_404 in step 4 is itself the signal that the IPC plumbing reaches `ApiClient.call('account.emailCode', ...)`. The backend integration belongs in `sanity-account-signup.mjs`, not in the desktop gate probe.

**Keep the legacy `main.tsx` as the dev entry and only flip production.** The renderer needs the same boot path in dev (`pnpm dev:renderer`) and in production (`npm run start`). Vite serves `index.html` directly; the script tag points at whichever file we choose. One entry, one decision.

## Consequences

The desktop renderer is now the Cordis entry — `app.tsx` and the six legacy pages remain in tree but are no longer loaded. The auth gate is the user-facing first impression: cold-start with empty safeStorage renders SignInCard; cold-start with a persisted bearer renders the Cordis shell (workspace picker, sidebar, conversation). Sign-out tears down the Cordis host and remounts the gate; sign-in does the inverse. The IPC broadcast from main keeps the gate in sync across multiple windows.

The renderer-entry test pins signed-out cold start, sign-in, and sign-out through the live auth-store subscription while replacing the Cordis host with a deterministic DOM mount. The CDP probe remains the keyless real-Electron check for the standalone gate and preload bridge. The renderer entry is one-way — there is no A/B between `main.tsx` and `main.new.tsx`.

The `.signin-gate` overlay mount owns the auth gate's lifecycle. If authentication restoration fails, `refresh()` projects signed-out state and the renderer fails closed on the standalone account page. The workbench never serves as a signed-out fallback, and embedded account surfaces expose no local-workspace bypass.
