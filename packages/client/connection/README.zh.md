# @deepseek-ai/dsh-client-connection

[English](README.md) | 中文

协议消费层：客户端插件的 apply 会挂载 `ctx.connection`（共享 API 客户端、所连接 Host 的 loopback 状态、可观察且按 generation 生效的 `hostDescription`，以及单消费方流循环启动器）；导出表层携带协议类型、`AbstractApiClient` 抽象与循环的 sink／配置类型。每次就绪握手成功后，都会在 `onConnected` 之前发布完整的 `host.describe` 值；generation 失效或显式 stop 会清空它。浏览器载体以 HTTP POST 发送 unary／respond，并为 `events.mux` 与 `events.host` 各开一条只下行的 WebSocket；进程内载体满足同一抽象。导出的 `ClientTransportHooks` 页面全局量 `__DSH_TRANSPORT__` 会为 worker 预览、Electron 桌面端等壳层整体替换该载体，并在壳层页面 URL 不包含目标 authority 时报告目标 Host 是否为 loopback。Host half 持有 `/api` route 及 Fetch bridge；已注册的 Typert interceptor 会先认领自己的 Remote endpoint，未认领请求再回退 API Proxy。平台载体与 `ConnectionController` 循环留在包内部。下行行为见 [WebSocket 下行载体 Agent Note](../../../.agents/notes/implemented/architecture/2026-08-04-websocket-downlink-carrier.zh.md)。

node 半侧把作用于服务端机器的操作（`host.pickDirectory`、`host.openPath`、`settings.openDocument` 与 `agentPreset.openDocument`）永久限制在回环地址。未挂载身份服务时，settings 读写、credentials 读写、`llm.discoverModels` 与 agent preset 的 read/copy/remove 也仅限回环。启用身份服务后，携带账户 Bearer token 的请求可经已声明的 `trustedHosts` 权威访问这组配置方法；匿名调用仍返回 403。`agentPreset.list` 与 `agentPreset.select` 是普通认证方法，因为其 id 与选择不会授予超出 `session.create` 的 `agentPreset` 字段以外的能力。

## /api 浏览器信任栅栏

node 半侧在桥接或 upgrade 前守卫 `/api` 下的每个入口（`src/api-request-trust.ts`）。每个请求——无论是否带浏览器标记——`Host` 都必须是回环地址，或与某个 `trustedHosts` 条目匹配：带端口的 `host:port` 条目精确匹配，不带端口的条目匹配任意端口，两侧均经 WHATWG 归一化后比较。无浏览器标记的 HTTP 请求没有捷径，因为浏览器在明文 HTTP 读取中可能同时省略 `Origin` 与 Fetch Metadata；Host 检查负责防御 DNS rebinding。带浏览器标记时，`Origin` 必须等于 Host 权威，`sec-fetch-site: cross-site` 一律拒绝。格式错误或非规范形的 `trustedHosts` 条目会让插件加载失败。HTTP 失败在 RPC 分发前返回纯 403，upgrade 失败在流启动前拒绝 WebSocket 握手。认证永远不能绕过这道权威检查。served Web 载体不注入 Bearer；桌面传输等账户感知壳层负责持有该凭据。决策记录：[API 浏览器信任边界 Agent Note](../../../.agents/notes/implemented/architecture/2026-07-28-api-browser-trust-boundary.zh.md)。

## `/api` WebSocket 下行

`/api/events.mux` 与 `/api/events.host` 各接受一条 WebSocket upgrade，并只向浏览器发送对应的 `ServerRequest` 文本消息；客户端不会在这些 socket 上发送业务数据。任一 socket 结束都会使当前 connection generation 失败并重建两条流，连接就绪仍要求两条 socket 均已打开且 `host.describe` HTTP 调用成功。Host teardown 会终止两条 socket、中止各自的 source，并等待 source 清理完成后再返回。普通网络 GET 这些路径会返回 426，不保留 SSE（Server-Sent Events）回退；`toFetchHandler` 的 SSE 编解码只服务进程内同构载体。

## 账户主体

挂载的账户服务启用后，Bearer 认证会把 token 解析为账户 `userId`，并让该主体贯穿 unary HTTP、下载、响应和两条 WebSocket 下行。有效 Bearer 在普通 loopback RPC 上仍保持账号 principal，使已登录桌面 Session 保留其 owner；不携带 Bearer 的 loopback 请求仍使用本机管理 principal。作用于服务端机器的方法在 loopback 上携带 Bearer 时也保留本机 principal。账号注册、登录、验证码、状态和退出登录可在声明的 authority 上先于认证调用，其他远程请求必须携带有效 Bearer。配置方法还要求请求来自 loopback 或已声明 authority，作用于服务端机器的操作则永久限制在 loopback。token 变化会创建新的桌面 connection generation：壳层在安装或清除 token 前会中止并等待两条旧下行结束，避免账户切换后继续收到上一个账号的 frame。

## 模型体验

无。协议消费层只在浏览器与主机之间搬运已经组合好的消息；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **History 会恢复未附加的会话**：打开 history 可能创建宿主侧 agent，并增加首次打开的延迟；没有仅从持久化读取的路径。
- **`/api` 桥把每个请求体整体缓冲在内存里**：`maxRequestBodyBytes`（默认 300 MiB，按默认 200 MiB 图片总量上限经 base64 膨胀加信封余量得出）因此同时是单请求的驻留内存上界；要降低它而不缩小图片限额，需要流式请求体路径。
