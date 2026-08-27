# Agent Note: 桌面端 generic Remote 经 IPC 保留 RPC 信封

Status: implemented

[English](2026-08-24-desktop-generic-remote-ipc-envelope.md) | 中文

## Problem

Electron renderer 在同一个主进程 API client 上有两条 unary 请求路径：typed `IApiClient` 使用 `IpcApiClientAdapter.doFetch()`，生成的 Typert Remote 则经 transport 的 fetch hook 使用 `ConnectionHandle.rpc`。该 hook 没有解码 `ClientRequest` body，而是把完整请求 URL 当作 RPC method、把 `RequestInit` 当作 payload 转发。`host.describe` 等 typed 调用可以成功，但所有生成的 Remote 都返回 carrier failure；Plugins 设置中的插件清单暴露了这处分裂：直接调用 `window.workbenchApi.request('pluginInventory/list', { args: {} })` 能返回条目，`ctx.remote.pluginInventory.list()` 却渲染不可用状态。

## Decision

`apps/desktop/src/renderer/transport.ts` 用同一个 `ipcFetch()` 适配两条 unary 路径。它读取 JSON `ClientRequest`，把其中的 `method` 与 `payload` 交给 `WorkbenchApiTransport.request()`，再用同一个 `rpcId` 重建 `ServerResponse`。因此无论调用方是 `IApiClient` method 还是生成的 Remote，成功值与错误都经过相同的 schema 校验和关联检查。主进程可能返回闭合 wire union 之外的错误码，所以 IPC 错误仍归一为协议的 `internal` 错误及空 details。

## Alternatives considered

- **在桌面端手写 API wrapper 中加入插件清单**——否决：这会复制生成的 Remote，且以后每个 generic namespace 仍以相同方式损坏。
- **让 `file:` renderer 用全局 `fetch` 直接调用 Host**——否决：这会绕过主进程持有的 bearer token、base URL 与单一 transport owner。
- **在 inventory 组件中直接调用 `window.workbenchApi`**——否决：展示组件通过 slot injection 接收数据，不得依赖 Electron 壳。

## Consequences

- 生成的 Remote 与 typed API 调用共享同一套 IPC 认证、base URL、响应校验及 `rpcId` 关联。
- generic fetch hook 接受 `createWebConnectionRpc` 生成的 JSON `ClientRequest`；不支持的 body 仍由现有响应解析器响亮失败，不引入第二种 wire format。
- `apps/desktop/tests/transport.test.ts` 固定了转发到 IPC 的 `pluginInventory/list` method、`{ args: {} }` payload 及相关联的 `ServerResponse`。真实 Electron 客户端从重启后的 Xiaowei Host 加载出 108 个插件条目。
