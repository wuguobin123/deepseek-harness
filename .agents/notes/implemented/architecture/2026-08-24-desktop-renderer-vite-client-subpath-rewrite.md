# Agent Note: desktop renderer vite /client subpath rewrite

Status: implemented

English | [中文](2026-08-24-desktop-renderer-vite-client-subpath-rewrite.zh.md)

## Problem

`pnpm --filter @deepseek-harness/desktop start` failed with `Rollup failed to resolve import "@deepseek-ai/dsh-host-apiproxy/client"`. The renderer could not launch against the production nginx endpoint at `http://119.45.252.25:18080`.

Three latent issues compounded:

1. **Missing workspace deps.** `apps/desktop/package.json` had no `@deepseek-ai/dsh-*` deps in `dependencies`. Vite resolves `@deepseek-ai/dsh-host-apiproxy/client` through the package's `exports` map; without the package linked in `node_modules` the import was unresolvable.

2. **`/client` subpath is a `__ModuleLoader__` factory, not ESM.** The tsdown `clientBundle()` preset in `packages/client/tsdown.client.ts` emits `lib/client.js` as `window.__ModuleLoader__.load({id, factory})` — a closure whose exports live on an internal `module.exports` but never appear at the ESM top level. The served web runtime consumes these via the cordis ModuleLoader (`packages/client/web/src/boot.ts:46-67`) and never reads them as static ESM imports. The desktop renderer imports 30+ packages via `@deepseek-ai/dsh-*/client` as static imports in `cordis-host.ts:28-64`, which vite/rolldown cannot statically resolve — the file yields zero ESM named exports.

3. **`api.ts` missing `artifact` namespace.** The xiaowei PR added `DocumentPreview.tsx`, `DocumentPreviewPanel.tsx`, and `HtmlPreviewRow.tsx`, each `import { artifact } from '../../api'` — but the renderer api namespace did not export an `artifact` object or `ArtifactKind` / `ArtifactMediaType` / `ArtifactView` types.

## Decision

Three coordinated changes:

### 1. Add missing workspace deps in `apps/desktop/package.json`

```jsonc
"dependencies": {
  "@deepseek-ai/cordis": "workspace:^",
  "@deepseek-ai/dsh-client-connection": "workspace:^",
  "@deepseek-ai/dsh-host-apiproxy": "workspace:^",
  "@deepseek-ai/dsh-typert-registry": "workspace:^",
  ...
}
```

`cordis` is the plugin framework dep. `dsh-client-connection` covers the few utility-type imports (`SessionId`). `dsh-host-apiproxy` is needed because `transport.ts` imports `AbstractApiClient` from its `/client` subpath. `dsh-typert-registry` covers `TypertRegistry`'s named-class export imported at `cordis-host.ts:27`.

### 2. Vite plugin rewrites `/client` subpaths to source TS

A `enforce: 'pre'` resolveId plugin in `vite.config.ts` matches `@deepseek-ai/dsh-{client,host,api}-*/client` and rewrites each to `<repo>/packages/<group>/<name>/src/client/index.ts`. Vite then compiles the TypeScript source as part of the desktop bundle.

The plugin only rewrites a subpath when `src/client/index.ts` exists — `@deepseek-ai/dsh-host-apiproxy/client` has no source subpath (its `/client` is built as ESM at `lib/types/fetch/client.js`), so the existing package resolution handles apiproxy transparently.

The 30+ packages using `apply()` (`client-ui-*`, `client-*`) all have `src/client/index.ts` and get rewritten.

### 3. Renderer `api.ts` exposes `artifact` namespace + types

Mirrors `packages/host/apiproxy/src/api/artifacts.ts:27-71`:
- `ArtifactKind = 'html' | 'slides' | 'doc' | 'sheet' | 'chart'`
- `ArtifactMediaType = 'text/html' | 'text/markdown' | 'image/svg+xml' | 'image/png' | 'image/jpeg' | 'application/pdf'`
- `ArtifactSource` with the six closed producers (`tool-html` / `tool-slides` / `tool-doc` / `tool-sheet` / `tool-mermaid` / `tool-svg`)
- `ArtifactView` with all wire fields
- `artifact.{list, read, remove}` wrappers using the existing `call()` helper

Brand-cast types (the host package's `ArtifactId = Branded<'ArtifactId'>`) become `string` at the renderer boundary — the renderer never needs the brand for narrowing.

### `client-connection` re-exports

`packages/client/connection/src/client/index.ts` adds re-exports of `hostFrameSchema`, `muxFrameSchema`, `serverRequestSchema` from `@deepseek-ai/dsh-host-apiproxy/api/*` so renderer consumers adapting `ClientTransportHooks` (e.g. the desktop IPC bridge) need not reach into the host package graph. These were added but **not adopted** in this PR — `apps/desktop/src/renderer/transport.ts` continues to import from `@deepseek-ai/dsh-host-apiproxy` directly because the workspace deps make that path resolvable. The re-exports remain available for future renderer consumers that prefer a single client-bundle import.

## Alternatives considered

- **Switch the desktop renderer to consume `__ModuleLoader__`** — rejected. The served web runtime's module system exists specifically because of cross-package module-table effects (cordis DI entities, `require()` injection, style tag stamping); the desktop shell ships a single static bundle, so the ModuleLoader's main benefit (lazy tiered loading) does not apply. Forcing the desktop through the ModuleLoader runtime would add ~30 inline `<script>`-tag evaluations and require shipping the `window.__DSH_BOOT__` / `window.__ModuleLoader__` globals the desktop main process would have to bootstrap.

- **Add `dsh-host-apiproxy` and a tsdown build of `client` per package that emits ESM** — rejected. 30 packages × 2 builds = 60 build configs and a per-package schema split (factory vs ESM). The factory bundle is a deliberate shape chosen by the ModuleLoader design. Changing the build for the desktop's sake pollutes the served web contract.

- **Have `cordis-host.ts` import each `apply` via a relative source path** — rejected. The PR1 webUI-parity work settled on `@deepseek-ai/dsh-*/client` as the public surface; rewriting 30+ imports to relative paths would lose the package boundary and couple the desktop to each package's source layout.

- **Use vite's `alias.find` with a function replacement** — rejected. Rolldown's `resolveId` plugin is the right tool — vite rejects function-shaped `replacement` strings in `alias.entries` with `StringExpected`.

- **Re-export `apply` and types via `lib/index.js`** — the `lib/index.js` artifact is a Cordis Loader plugin entry (the server-side apply path), not the browser-friendly ClientApply path. Mixing the two would confuse the served-web's Cordis Loader, which reads `lib/index.js` as a plugin registration.

## Consequences

### Benefits

- **Desktop launches against the production nginx endpoint.** The full cordis plugin graph (`connection → runtime → settings → theme → ... → 30+ feature plugins → renderer`) activates in the static renderer bundle; the WebSocket `/api/events.mux` / `/api/events.host` downlinks and `POST /api/<method>` unary carriers route through the desktop's IPC bridge to the production nginx at `http://119.45.252.25:18080`.

- **One renderer source, no per-package fork.** The vite plugin matches the package-naming convention; adding a 31st package that follows the same `src/client/index.ts` convention needs no vite-config change.

- **Desktop renderer is self-contained.** It compiles against the repo source directly; the ModuleLoader runtime, the `__DSH_BOOT__` manifest, the cordis plugin loader, and the worker-tunnel transport hooks are all skipped on the desktop shell — they belong to the served web runtime only.

- **Renderer types stay accurate.** `ArtifactView` / `ArtifactKind` / `ArtifactMediaType` in `api.ts` match the host wire surface; future host-side additions (a new media type or source) need renderer-side updates and a renderer rebuild.

### Costs

- **Vite plugin must understand the package-naming convention.** `client-*` / `host-*` / `api-*` workspace groups are hard-coded in the regex. Renaming a group (e.g. `client-ui-*` → `dsh-client-ui-*`) requires a regex update.

- **CSP / font warnings.** The bundled webUI ships `data:font/woff2` URIs that the desktop's strict CSP (`font-src 'self'`) rejects. This is a non-fatal warning — the renderer still paints with fallback fonts. Out of scope for this PR.

- **Bundle size.** The full webUI bundle is ~2.1MB minified (`dist/renderer/assets/index-*.js`). Out of scope for this PR — the desktop renderer does not need a code-split manualChunks configuration to launch.

- **`tsdown.client.ts` factory shape unchanged.** The served web keeps its `__ModuleLoader__` factory-bundle contract; the desktop's source rewrite is a one-way asymmetry between the two surfaces, justified by their different runtime models.

- **`packages/client/connection/src/client/index.ts` re-exports unused.** The `hostFrameSchema` / `muxFrameSchema` / `serverRequestSchema` re-exports added in this PR are not yet consumed (the desktop `transport.ts` continues to import from `@deepseek-ai/dsh-host-apiproxy`). They remain available for future renderer consumers; deleting them would require updating the desktop transport import to match.
