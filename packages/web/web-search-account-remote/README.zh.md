# @deepseek-ai/dsh-web-search-account-remote

[English](README.md) | 中文

`account-remote` 提供方运行在设备 Worker 中，通过严格的子进程 IPC 将搜索转发给受信任的 Electron 父进程。线路请求只有 `query`、`maxResults` 和 `requestId`，不会传递凭据、身份、路径或工作区/会话数据。

提供方支持并发请求、取消、父进程断开，并对畸形或串线消息失败关闭；Worker 不执行网络请求。小薇桌面父进程处理对应的 IPC 消息，把当前账号 Bearer Token 附加到 `account.web.search`，并在结果返回 Worker 前校验云端响应。

## 模型体验

模型通过 `dsh-tool-web` 在本地与云端工作区看到一致的规范化搜索来源。传输或认证失败会显示为提供方错误，不会静默移除工具。

#### KV 缓存影响

仅追加；搜索来源和提供方错误位于可复用请求前缀之后。

## 已知限制与后续工作

- 搜索需要有效且在线的小薇账号会话。
- Web Fetch 仍由设备执行，不经过该提供方路由。
