# 小薇 — Desktop Client

English | [中文](README.zh.md)

Electron desktop client for the dsh-ops deployment. The client speaks the same
RPC envelope as the dsh web frontend (`@deepseek-ai/dsh-host-apiproxy`), so the
two surfaces stay interchangeable against the same backend.

## Goals

- Hard process isolation between **main**, **preload**, and **renderer**.
- Renderer cannot reach `fetch` for the backend directly; main process owns
  every RPC POST, SSE subscriber, and IPC event fan-out.
- Renderer cannot open arbitrary URLs; the only external nav is the user's
  explicit "open update download" action through main.
- Strict CSP, no remote navigation, no new windows, no `nodeIntegration`.
- Strict TypeScript everywhere, React + Zustand in renderer, Vitest for unit
  tests.

## Product branding

The desktop assembly owns the Xiaowei product identity. Its renderer plugin
fills the shared sidebar and conversation brand slots with the Xiaowei mark,
and the packaged application, browser, and native window titles use `小薇`.
Electron Builder converts `features/brand/xiaowei-logo.png` into the native
macOS, Windows, and Linux application and installer icons. Generic DSH clients
retain their own build-selected branding.

The desktop Session body exposes the conversation view only; it does not register the optional Trajectory tab available in the generic Web client.

## Execution environments

A fresh installation defaults to **Local**. The main process supervises one `xiaowei-local` Host on an operating-system-assigned `127.0.0.1` port. Adding a Workspace in this environment passes only the canonical selected path to that loopback Host's `workspace.create`; it does not enumerate, encode, upload, or duplicate the directory, so cloud-copy file-size limits do not apply. External changes and Agent edits address the same source directory.

**Cloud** is an explicit alternative. Adding a Workspace there retains the bounded `workspace.importDirectory` flow and creates an independent account-private copy; later local changes do not synchronize automatically. Sessions, Workspace ids, event streams, and artifact reads stay with the environment that created them. Switching environments aborts the old streams and reloads the renderer against the selected Host.

The local Host stores its model configuration, credentials, Sessions, metadata, and installed Skills below Electron application data. An approved conversational Skill installation writes only to that local Skill root. The directory is not uploaded as a cloud Workspace, but content intentionally included in a model request still reaches the locally configured model provider. Local mode does not silently use the cloud account wallet.

Settings → Skills lists the complete Skill bundles installed in the formal desktop runtime. “Install Skill directory” opens a native directory picker; the main process validates and atomically copies nested regular files below `<userData>/local-runtime/skills` without exposing either path to the renderer or uploading the bundle. Existing different content is reported as a conflict and is never overwritten. This installed inventory is device state, not proof that a particular Session has loaded the Skill; valid entries retain the existing `/<skill-name>` invocation contract.

## Layout

```
apps/desktop/
├── package.json          # Electron + Vite + Vitest scripts
├── tsconfig.json         # Renderer/Preload TS config
├── tsconfig.node.json    # Main process TS config
├── vite.config.ts        # Renderer build + Vitest config
├── electron-builder.yml  # Packaging (dmg / AppImage / nsis)
├── product-config.json   # Default apiBaseUrl baked into the binary
└── src/
    ├── shared/contracts.ts   # dsh RPC + Mux/Host stream envelope schemas
    ├── main/                 # Electron main process
    │   ├── index.ts          # App lifecycle + secure BrowserWindow
    │   ├── api-client.ts     # RPC client over POST /api/<method>
    │   ├── sse-proxy.ts      # WebSocket downlink + heartbeat → typed IPC fan-out
    │   ├── credential-store.ts # connection preferences + encrypted account session
    │   ├── ipc-handlers.ts   # Typed ipcMain handlers
    │   ├── local-skill-directory.ts # Bounded, atomic local Skill bundle store
    │   └── update-checker.ts # Same-origin release-manifest polling
    ├── preload/index.ts      # contextBridge.exposeInMainWorld('workbenchApi')
    └── renderer/             # React + HashRouter
        ├── main.tsx
        ├── app.tsx
        ├── api.ts            # typed wrappers over window.workbenchApi
        ├── stores/session.ts # baseUrl slice
        └── features/
            ├── home/         # Sessions list + new-session button
            ├── assistant/    # Thread + composer, MuxFrame subscription
            ├── tasks/        # session/jobs aggregator
            ├── approvals/    # approval/requested inbox + decide
            ├── history/      # session.search form
            └── settings/     # baseUrl field + host.describe probe
```

## Preload contract

```ts
window.workbenchApi.request(method, payload)            // POST /api/<method>
window.workbenchApi.subscribeMux(listener)              // SSE → MuxFrame
window.workbenchApi.subscribeHost(listener)             // SSE → HostFrame
window.workbenchApi.respond(rpcId, value, error?)       // POST /api/respond
window.workbenchApi.getSession()                        // { baseUrl, environment, version }
window.workbenchApi.updateSession({ baseUrl, environment })
window.workbenchApi.checkAppUpdate()                    // GET /releases/latest.json
window.workbenchApi.openAppUpdateDownload()             // validated shell.openExternal
```

Nothing else is exposed: `ipcRenderer`, `require`, `process` are not on the
bridge.

The main process sends protocol ping frames on both downlinks. A missing pong terminates that connection generation; the shared connection controller then reopens mux and host together and repulls every open session. Application-event silence alone never marks a healthy workspace as disconnected.

## Pages

| Route | Surface |
|---|---|
| `/` | Home — sessions list + new-session button |
| `/assistant/:sessionId` | Assistant — thread + composer; Mux subscription |
| `/tasks` | Tasks — `session/jobs` aggregator across all sessions |
| `/approvals` | Approvals — pending `approval/requested` + decide |
| `/history` | History — `session.search` results |
| `/settings` | Settings — `baseUrl` field + `host.describe` probe |

After sign-in, the sidebar footer shows the current user, MiniMax allowance, and a right-aligned client-update icon. The user body opens Settings → Account, while the update icon remains an independent action. Sign-out is available only from the Account section. Registration grants the configured one-time 20 CNY allowance through `account.wallet.grantWelcomeBonus`.

## Install / build / test

```bash
cd apps/desktop
pnpm install
pnpm run typecheck
pnpm run test           # Vitest
pnpm run build          # tsc emits main + Vite emits renderer
pnpm run start          # launches Electron against the built renderer

# Point the build at a different backend, then package:
WORKBENCH_API_BASE_URL=https://assistant.example.com pnpm run package:mac
```

## Packaging

`electron-builder` produces:

- macOS Apple Silicon — `pnpm run package:mac`
- macOS Intel — `pnpm run package:mac:x64`
- Linux `.AppImage` — `pnpm run package:linux`
- Windows `.exe` (NSIS) — `pnpm run package:win`

The preload is bundled into a single CommonJS file before packaging because
Electron's sandboxed preload cannot load arbitrary local modules. Packaging also
deploys a self-contained `local-runtime` resource used by the supervised Local
Host; its Sessions, settings, credentials, and installed Skills remain under
Electron application data. Local artifacts are ad-hoc signed; a public release
still needs an Apple Developer ID certificate and notarization. The DMG is
`小薇-<version>-arm64.dmg`.

On Apple Silicon, an unsigned DMG triggers Gatekeeper quarantine. For internal
deploys:

```sh
xattr -dr com.apple.quarantine "/Applications/小薇.app"
```

## Backend contract

The desktop client speaks the dsh RPC envelope defined in
`@deepseek-ai/dsh-host-apiproxy`. The wire format is shared with the dsh web
frontend; see `packages/host/apiproxy/src/api/rpc.schema.ts` and
`packages/host/apiproxy/src/api/events.ts`. The renderer only reaches the typed
wrappers in `src/renderer/api.ts`; it never constructs envelopes by itself.

The default backend is `http://119.45.252.25:18080/` (the dsh-ops nginx → apiproxy
hop). Override at build time with `WORKBENCH_API_BASE_URL`, or change it at
runtime on the Settings page.

## Security checklist

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
- CSP forbids `default-src 'self'`; no remote scripts
- `will-navigate` and `new-window` events are blocked
- Preload only exposes `window.workbenchApi`
- Renderer cannot reach `fetch` for the API — headers (when any) and the
  baseUrl are owned by main
- `shell.openExternal` is restricted to the app-update download path

## Tests

```bash
pnpm run test           # Vitest unit tests (preload, account footer, updater)
```

## Product deployment boundary

The DMG contains both the desktop client and its Local Host runtime. Local mode
keeps its model configuration, credentials, Sessions, metadata, and installed
Skills in Electron application data. Cloud mode uses the dsh-ops backend for
account-owned model access, connectors, workflows, and audit data. Configure
`WORKBENCH_API_BASE_URL` to the cloud deployment's HTTPS URL before packaging.
See [`docs/ops/acceptance-report.md`](../../docs/ops/acceptance-report.md).
