# Agent Note: xiaowei bundle 与认证信任栅栏

Status: implemented

[English](2026-08-24-xiaowei-bundle-and-trust-fence.md) | 中文

## 问题

`dsh-xiaowei` 是本代码库第一个以**长生命周期多用户服务**形式运行的 bundle。之前的每个 bundle（`dsh-ops`、`dsh-headless`、`dsh-web-app`）要么在 loopback 下交付，要么以单一 LAN 客户端的短生命周期形式交付。xiaowei 表面接受来自匿名 LAN 调用者的请求（注册是公开端点）、来自已登录桌面客户端的请求（多数特权方法），以及来自桌面 CDP 探针的请求（特定的调试方法）。需要一并解决三个关切：

- 一次部署实际暴露哪些方法——让 LAN 调用者命中无头服务器上的 `host.pickDirectory` 没有意义。栅栏必须强制这点，而不仅仅是单方法门。
- 非 loopback 部署把哪些权威视为受信的，以覆盖其余方法。`trustedHosts` 已经存在；本次 PR 扩展其词汇表，并真正在 wire 侧进行检查。
- 桌面客户端的 token 需要随每次非公开请求一起发送，同时不能取代用于防止浏览器 confused-deputy 请求的 Host、Origin 与 Fetch Metadata 检查。

## 决策

### Bundle 组合

`packages/bundle/xiaowei/cordis.patch.yml` 按依赖顺序挂载：

1. `storage` + `storage-json` + `storage-domain`——session 持久化所需。
2. `session-projection-cache`、`session-reference`、`message-feedback`、`workspace`。
3. `session-persistence-sqlite`——既有的单文件 session 日志。
4. `identity`——[`2026-08-24-xiaowei-account-seam.zh.md`](2026-08-24-xiaowei-account-seam.zh.md) 中的 `LocalIdentityProvider`。
5. `email-verification`、`wallet`、`user-model-keys`、`artifact-store-fs`。
6. `api-gateway`——既有的 `dsh-host-apiproxy`。
7. `connection`——`dsh-client-connection`，`trustedHosts` 由 `XIAOWEI_TRUSTED_HOSTS` env 推导。
8. `webserver`——`dsh-host-webserver`，绑定 `XIAOWEI_HOST` / `XIAOWEI_PORT`（默认 `127.0.0.1:18000`）。
9. `frontend-static`——`dsh-host-frontend-static`（由 `XIAOWEI_SERVE_FRONTEND` 控制开关）。
10. `xiaowei-startup`——发布被 runner 消费的 `XIAOWEI_STARTUP_SERVICE` Cordis 服务。
11. `xiaowei-runner`——替代 `dsh-headless` 的 `headless-startup`（在空 argv 上 `program.error`）与 `headless-runner`（一次性前台任务）。空 argv 时 runner 闲置；HTTP `/api/<method>` 通道才是服务桌面客户端的入口。
12. `hmr` **禁用**——多用户会话不能在文件编辑时静默重启，重启也会拆掉绑定的 socket。

### 能力声明

`host.describe` 之前只返回 version、cwd、provider、model、attached sessions、home、canOpenPath。本次 PR 新增一个**可选** `capabilities` 字段：

```text
capabilities?: {
  account?: boolean
  wallet?: boolean
  modelKeys?: boolean
  artifact?: boolean
  emailVerification?: boolean
  userContext?: boolean
  e2b?: boolean
}
```

每个标志仅在匹配的 Cordis Service 已注册时为 `true`（`ctx.get('identity') !== undefined` 等）。桌面渲染器读取该字段来决定哪些设置分区、侧栏入口、账户门值得渲染，因此一份未组合 `dsh-xiaowei` 的部署（例如 `dsh-ops` 安装）会报告一个不存在的 `capabilities` 对象，桌面端退回到保守表面。harness 核心从不报告 `capabilities`——bundle 作者通过 `XIAOWEI_STARTUP_SERVICE` 发布它们，再在 `api-proxy.ts` 中读取。

### 权威与认证

每个 HTTP 请求与 WebSocket upgrade 都先通过 `isTrustedApiRequest`：`Host` 必须是 loopback 或匹配 `trustedHosts`，附带的浏览器标记必须同源，显式跨站请求会被拒绝。Bearer 认证永远不能绕过这些检查。

```ts ignore-check
isTrustedApiRequest(request, trustedHosts)
  && (isPublicMethod(method) || authenticateApiRequest(request, ctx))
```

挂载 identity 后，`authenticateApiRequest` 会提取 `Authorization: Bearer <token>`，通过 `ctx.identity` 验证，并让得到的账户主体贯穿 unary RPC 与两条 WebSocket 下行。`account.signup`、`account.signin`、`account.emailCode`、`account.state` 与 `account.signout` 在认证前仍可调用；其他所有 API 方法即使来自 loopback 也要求有效 Bearer token。

配置方法还有一条附加规则。没有 identity 时，settings 与 credentials 读写、模型发现以及 agent preset 的 read/copy/remove 仍仅限 loopback。启用 identity 后，有效账户 Bearer token 可以经已声明权威调用这些方法；远程 Xiaowei Host 上的桌面 Models 页面依靠此路径加载和编辑。作用于服务端机器的操作（`host.pickDirectory`、`host.openPath`、`settings.openDocument` 与 `agentPreset.openDocument`）即使面对已认证账户也永久限制在 loopback。

### Connection inject

`packages/bundle/xiaowei/cordis.patch.yml` 在 `connection` 行加 `inject: [webRuntime, identity]`。栅栏依赖 `ctx.identity` 在首次请求前已挂载，因此依赖注入顺序与实际挂载顺序一致。

### 生产部署

`scripts/deploy_xiaowei.sh`（另一篇 Agent Note）是规范的生产部署入口；它从 SSH 目标推导 `XIAOWEI_TRUSTED_HOSTS`（`127.0.0.1,localhost,<公网 IP>`），加上运维提供的 `XIAOWEI_TRUSTED_HOSTS_EXTRA`，写入 systemd 单元、写入把公网 `:18080` 映射到 loopback `:18000` 的 nginx 反向代理片段，并把 `XIAOWEI_*` env 写入 `/etc/dsh-xiaowei/server.env`（幂等——只填入不存在的键，因此经独立管理员路径的人工密钥轮换在重新部署后仍被保留）。

## 备选方案

- **移除 `trustedHosts`，只使用 Bearer 认证**——拒绝。通过攻击者控制 Host 提交的有效 token 不能把本地服务器变成浏览器可访问的代理；权威与同源检查必须和身份检查累加。
- **让整个配置 API 永远仅限 loopback**——拒绝。这样会让已认证远程桌面端的 Models 页面在 `settings.describe` 失败，而 Bearer 已提供区分该客户端与匿名 trusted-host 调用方所需的账户身份。原生宿主操作继续仅限 loopback。
- **跳过能力声明，始终渲染所有分区**——拒绝。今天桌面壳同时承载 `dsh-ops`（无 `identity`、无 `wallet`）与 `dsh-xiaowei`（具备全部能力）。始终渲染意味着 ops 安装会得到永远 403 的「登录」按钮和「查看钱包」卡片。基于 `host.describe.capabilities` 的条件渲染是以一份渲染器支撑两个 bundle 的最便宜方式。
- **在每个特权方法内部做 Bearer 认证**——拒绝。connection route 是请求身份的单一所有者；把 token 检查散落到各方法实现中容易遗漏，也无法把主体附着到 WebSocket 订阅。
- **带角色参数的单一 `account.*` 超级方法**——拒绝。`signup` / `signin` 公开；`wallet.credit` / `modelKeys.revoke` 管理员 loopback。单一方法在体内需要两道门，参数表本身就成为鉴权面。分开的方法加上栅栏按方法把关更清楚。

## 影响

### 收益

- **一份渲染器承载两个 bundle**——`apps/desktop` 用同一份代码同时对接 `dsh-ops` 与 `dsh-xiaowei`。`host.describe` 中的能力位集是区分两者的唯一信号。
- **令牌自动传播**——桌面主进程的每次特权 HTTP 调用都附加 `Authorization: Bearer <token>`；无需按方法穿线。
- **可达性与身份保持累加**——受信权威不等于调用方已认证，Bearer 也不会覆盖 Host 或浏览器来源拒绝。
- **认证远程配置可用**——桌面端可以加载 `settings.describe` 与可配置提供方目录，同时不会把服务端机器的原生操作开放到网络。
- **一次命令完成生产部署**——`scripts/deploy_xiaowei.sh`（无标志）是运维入口。脚本处理备份、rsync、systemd、nginx、env 文件、重启和双层健康检查。

### 代价

- **每次特权请求一次索引 PK 查询**——命中栅栏的每次 HTTP 请求对 `sessions.token` 查一次。缓存故事（last-seen-at 跟踪）是未来优化；本次 PR 不做缓存。
- **`XIAOWEI_MASTER_KEY` 部署时必须存在**——`provision()` 大声失败是唯一安全的行为。部署脚本强制要求存在。
- **`XIAOWEI_TRUSTED_HOSTS` 必须包含每个公网权威**——新增公网主机名（例如 `xiaowei.<ip>.nip.io` 别名）需要编辑 `cordis.patch.yml` 的 `trustedHosts` 推导，或者在 `server.env` 中设置 `XIAOWEI_TRUSTED_HOSTS_EXTRA`。部署脚本在末尾打印解析后的列表，以便在部署日志中暴露误配置。
- **每次认证请求都执行身份验证**——HTTP 调用与 WebSocket connection generation 会在身份存储中验证 session token；实现不缓存该结果。
