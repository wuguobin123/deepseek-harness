# Agent Note：Xiaowei 账户会话隔离

Status: implemented

[English](2026-08-24-xiaowei-account-session-isolation.md) | 中文

## 问题

Xiaowei 的 HTTP 请求完成 Bearer token 校验后，只保留了认证有效这一布尔事实。账户 `userId` 在 API Proxy 分发前被丢弃，而 Session 头和两个持久化后端都没有所有者字段。Session 列表、历史、变更、导出和实时事件流因此操作同一个进程级集合，切换到另一个账户后会暴露前一账户的会话内容。

桌面壳层还把所有已登录状态视为同一个 connection generation。从账户 A 直接切换到 B 时，安装 B 的 token 后仍可能保留 A 的 mux 与 host 下行。

## 决定

Bearer 认证现在会生成包含 `userId` 的账户主体；传输层让它贯穿 unary HTTP、响应投递、下载和两条 WebSocket 下行。API Proxy 用该身份作为 `ownerId` 标记新建 Session，并在加载 Agent 或返回数据前，对每个通过 Session 寻址的读取或变更执行授权。列表和搜索同时过滤已附加与冷 Session；导出、子智能体与目标操作、待处理交互、任务和实时 Session frame 使用相同的所有者规则。API 表层无法区分外部账户的 Session 和不存在的 Session。

`ownerId` 是一个 branded、可选的 Session 头字段。JSONL 把它记录在头部，SQLite schema 18 把它记录在 `sessions.owner_id`，派生会话继承该字段。非账户单用户组合的本地进程内调用方仍不受该作用域限制。账户请求不能查看或认领没有所有者的 Session。

桌面连接键包含已认证的 `userId`。账户变化时，壳层会先中止并等待两条旧下行结束，再安装下一个 token 并创建新的 connection generation。

## 持久化兼容性

增加 `ownerId` 会改变 Session 头格式，因此 `SESSION_FORMAT_VERSION` 为 1。仓库处于预发布阶段，不提供 v0 到 v1 或 SQLite 17 到 18 的迁移。既有 v0 JSONL 根和 schema 17 数据库会被明确拒绝；部署时必须使用全新的 Session 存储，或另行评审所有者分配迁移。禁止在首次登录时自动认领，因为这会把共享历史会话分配给最先到达的账户。

## 验证

聚焦的 Session、JSONL、SQLite、API Proxy、connection 和桌面测试覆盖所有者持久化、账户 A/B 的列表与访问隔离、主体传播、事件流认证和 token 切换 teardown。无密钥 snapshot 套件会重放当前 v1 Session fixture。Session、持久化、API Proxy 与 connection 包的聚焦 TypeScript program 均可编译。

## 曾考虑的替代方案

- **只在 renderer 过滤**：直接 HTTP、下载、WebSocket frame 和变更方法仍会暴露或修改其他账户的 Session，因此拒绝。
- **在 Session id 前添加账户 id**：Session id 是不透明的持久标识符，而且调用方可以提交预分配 id；所有权必须独立于命名执行校验，因此拒绝。
- **把每个无所有者 Session 认领给第一个认证账户**：当前共享存储无法证明哪个历史账户创建了某个 Session，因此拒绝。

## 影响

账户作用域的部署会在服务端隔离存储数据和实时数据中的 Session。非账户本地组合保持原有行为。带旧 Session 数据的部署在重启前必须做出明确的数据处理决定；账户身份、token 与钱包数据使用独立存储，不会被这次 Session 格式变化改写。
