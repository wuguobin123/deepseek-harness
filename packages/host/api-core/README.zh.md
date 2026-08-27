# @deepseek-ai/dsh-host-api-core

[English](README.md) | 中文

面向小薇本地 Worker 的设备安全回环载体。默认 Cordis 插件要求 `ctx.apiProxy` 与 `ctx.typertGateway`，把 HTTP 与 WebSocket 服务器绑定到 `127.0.0.1`，在启用 `printUrl` 时打印所选 URL，并随 fiber 关闭监听器和活动事件流。配置接受 `{port?, printUrl?}`；端口 `0` 表示由操作系统选择可用端口。

旧式点号 ApiProxy 调用与活动 Typert Gateway 声明的所有斜杠 endpoint 共用 `/api/<method>`。两条路径都保留 `ClientRequest` 与 `ServerResponse` 信封、rpcId 关联、本地主体、JSON 媒体类型要求和取消信号。Gateway 未声明的斜杠 endpoint 仍返回 404，绝不转发到云端 Host。`/api/events.mux` 与 `/api/events.host` 是仅下行的 WebSocket 流；客户端发送消息时，载体会用策略错误 1008 关闭连接。

## 模型体验

### 本地 RPC 载体

#### 模型可见内容

无。`ClientRequest` 与事件帧载体不会贡献提示词、工具 schema 或工具结果。

#### Token 影响

无；该包既不组装也不发送提供方请求。

#### KV Cache 影响

无；该载体不贡献模型可见内容，因此不会改变缓存键。

## 已知限制与暂缓事项

- **仅限回环地址**：该载体有意不提供外部绑定选项、TLS、账户认证或云端回退。可通过网络访问的部署必须使用具备账户隔离的远程 Host。
- **每个插件实例只有一个监听器**：端口分配和进程监管归桌面本地运行时 supervisor 所有；该载体不会发现或替换另一个正在运行的 Worker。
