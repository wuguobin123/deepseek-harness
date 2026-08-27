# Agent Note: Desktop generic Remote calls preserve RPC envelopes through IPC

Status: implemented

English | [中文](2026-08-24-desktop-generic-remote-ipc-envelope.zh.md)

## Problem

The Electron renderer has two unary request paths over one main-process API client: the typed `IApiClient` uses `IpcApiClientAdapter.doFetch()`, while generated Typert Remotes use `ConnectionHandle.rpc` through the transport's fetch hook. The hook forwarded the complete request URL as the RPC method and `RequestInit` as its payload instead of decoding the `ClientRequest` body. Typed calls such as `host.describe` succeeded, but every generated Remote returned a carrier failure; the Plugins settings inventory exposed the split because a direct `window.workbenchApi.request('pluginInventory/list', { args: {} })` returned entries while `ctx.remote.pluginInventory.list()` rendered its unavailable state.

## Decision

`apps/desktop/src/renderer/transport.ts` owns one `ipcFetch()` adapter for both unary paths. It reads the JSON `ClientRequest`, forwards its `method` and `payload` through `WorkbenchApiTransport.request()`, then reconstructs a `ServerResponse` with the same `rpcId`. Success values and errors therefore follow the same schema validation and correlation checks whether the caller is an `IApiClient` method or a generated Remote. IPC error codes remain normalized to the protocol's `internal` error with empty details because the main process may return codes outside the closed wire union.

## Alternatives considered

- **Add plugin inventory to the desktop's hand-written API wrappers** — rejected because it duplicates the generated Remote and leaves every later generic namespace broken in the same way.
- **Let the `file:` renderer call the Host with global `fetch`** — rejected because it bypasses the main process's bearer token, base URL, and single transport owner.
- **Call `window.workbenchApi` from the inventory component** — rejected because presentation components receive data through slot injection and must not depend on the Electron shell.

## Consequences

- Generated Remotes and typed API calls share the same IPC authentication, base URL, response validation, and `rpcId` correlation.
- The generic fetch hook accepts the JSON `ClientRequest` form produced by `createWebConnectionRpc`; unsupported bodies still fail through the existing response parser rather than gaining a second wire format.
- `apps/desktop/tests/transport.test.ts` pins the `pluginInventory/list` method and `{ args: {} }` payload forwarded to IPC and the correlated `ServerResponse`. A running Electron client loads 108 inventory entries from the restarted Xiaowei Host.
