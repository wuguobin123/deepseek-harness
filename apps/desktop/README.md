# Enterprise AI Workbench — Desktop Client

Secure Electron desktop client for the enterprise AI workbench. Implements WP6 of the
[workbench refactor](../../docs/32-enterprise-ai-workbench-implementation-spec.md#18-work-packages).

## Goals

- Hard process isolation between **main**, **preload**, and **renderer**.
- API Key lives only in main process via `safeStorage`; renderer never sees it.
- Renderer cannot open arbitrary URLs. `shell.openExternal` is gated by a backend
  "authorize-open" round-trip and only fires for verified `VerificationArtifact` IDs.
- Renderer cannot speak EventSource with custom auth headers. SSE is proxied by the
  main process and forwarded as typed IPC events.
- Strict CSP, no remote navigation, no new windows.
- Strict TypeScript everywhere, React + Zustand in renderer, Vitest for unit tests,
  Playwright for end-to-end.

## Layout

```
apps/desktop/
├── package.json          # Electron + Vite + Vitest scripts
├── tsconfig.json         # Renderer/Preload TS config
├── tsconfig.node.json    # Main process TS config
├── vite.config.ts        # Renderer build + Vitest config
├── electron-builder.yml  # Packaging (dmg/AppImage/nsis)
├── .eslintrc.cjs
└── src/
    ├── shared/contracts.ts   # Typed contracts + Zod schemas shared with preload
    ├── main/                 # Electron main process
    │   ├── index.ts          # App lifecycle + secure BrowserWindow
    │   ├── api-client.ts     # HTTP client with retry + auth headers
    │   ├── event-stream.ts   # Main-process SSE proxy -> typed IPC
    │   ├── credential-store.ts # safeStorage wrapper, 0600 file on macOS
    │   ├── verified-links.ts # authorize-open-then-shell.openExternal
    │   └── ipc-handlers.ts   # Typed ipcMain handlers
    ├── preload/index.ts      # contextBridge.exposeInMainWorld('workbenchApi')
    └── renderer/             # React + Zustand
        ├── index.html
        ├── main.tsx
        ├── app.tsx
        ├── routes.tsx
        ├── api.ts            # typed wrapper around window.workbenchApi
        ├── stores/{session,anomalies,triggers}.ts
        ├── components/
        └── features/
            ├── anomalies/    # AnomaliesPage + AnomalyDetailPage
            ├── triggers/TriggersPage.tsx
            ├── history/HistoryPage.tsx
            ├── knowledge/KnowledgePage.tsx
            └── settings/SettingsPage.tsx
```

## Preload contract

```typescript
window.workbenchApi.request({ method, path, body? })
window.workbenchApi.subscribeAnomalies((event) => …)
window.workbenchApi.openVerificationArtifact(artifactId)
window.workbenchApi.getSession()
window.workbenchApi.updateSession({ apiKey?, tenantId?, actorId?, baseUrl? })
window.workbenchApi.authenticateSession({ mode, baseUrl, email, password, displayName? })
window.workbenchApi.logoutSession()
```

Nothing else is exposed: `ipcRenderer`, `require`, `process` are not on the bridge.

## Pages

- `/anomalies` — list with filters (status / severity / owner)
- `/anomalies/:id` — detail with occurrence timeline, conversation, snapshot,
  verification button
- `/triggers` — list / create / edit cron / event / condition triggers
- `/history` — execution history (read-only)
- `/knowledge` — document import, search, source links, and cited AI answers
- `/integrations` — REST/MCP/飞书/企微/钉钉 Connector 管理
- `/automations` — at/every/cron/event/condition 自动化与最近运行
- `/settings` — 账号、服务连接、模型、¥20 平台额度与 BYOK

## Install / build / test

```bash
cd apps/desktop
npm install
npm run typecheck
npm run test
npm run build
npm start           # launches Electron against built renderer
WORKBENCH_API_BASE_URL=https://assistant.example.com npm run package:mac
```

## Packaging notes

`electron-builder` produces:

- macOS Apple Silicon: `npm run package:mac`
- macOS Intel: `npm run package:mac:x64`
- Linux: `.AppImage`
- Windows: `.exe` NSIS installer

The preload is bundled into one CommonJS file before packaging because Electron's
sandboxed preload cannot load arbitrary local modules. On Apple Silicon,
`npm run package:mac` produces:

```text
release/Enterprise AI Workbench-0.1.0-arm64.dmg
```

The local artifact is ad-hoc signed. A public release still requires an Apple
Developer ID certificate and notarization. Intel packaging is intentionally a
separate command so a missing x64 Electron runtime cannot block the native arm64
artifact.

## Backend contracts

The desktop client only calls the API surface listed in §11 of the workbench
implementation spec. While those endpoints are implemented by other work packages,
the desktop app uses a stub `apiClient` for tests and local development. See
`src/renderer/api.ts` for the typed surface.

## Security checklist

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
- CSP forbids `default-src 'self'`; no remote scripts. `frame-src 'self' blob:`
  is allowed so the document preview panel can render blob: URLs (HTML text
  previews and converted PDFs) in its sandboxed iframe
- `will-navigate` and `new-window` events are blocked
- Preload only exposes `window.workbenchApi`
- Renderer cannot reach `fetch` for API endpoints — `safeStorage` keys never cross
  the IPC boundary
- `shell.openExternal` is gated by `POST /api/verification-artifacts/{id}/open`

## Tests

```bash
npm run test               # Vitest unit tests (security + preload contract)
npm run test:e2e           # Playwright smoke (anomaly-flow)
```

## Product deployment boundary

The DMG contains the desktop client, not platform model secrets. A release build must be
configured with the HTTPS URL of a deployed workbench backend. This keeps shared model keys,
wallets, connectors, workflows and audit logs server-side. See
[`docs/34-office-agent-product-delivery.md`](../../docs/34-office-agent-product-delivery.md).
