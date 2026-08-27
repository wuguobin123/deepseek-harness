# Agent Note: xiaowei 本地身份服务与 bearer 认证栅栏放宽

Status: implemented

[English](2026-08-23-xiaowei-auth-and-fence-relaxation.md) | 中文

## 问题

xiaowei 部署（PR 2 第 10.1a 步）是与 Electron 桌面客户端配套的多用户远端后端。`packages/client/connection` 中的特权方法栅栏只接受回环调用方，因此桌面端要么必须处于同一回环端口，要么借助其它可信身份机制。同样的回环限定也挡住了任何非回环 LAN 部署以及未来的远端前端。在没有真正的身份服务时，线缆协议无法对刚注册成功的 LAN 调用方进行身份验证，`account.signup` 自身也无法跨过栅栏落地。

紧随其后还有三个子决策：身份放哪里——拆成独立的 `account-identity` 定义包和 `account-identity-local` 提供方包，还是合并到一个包？用户与会话表放在哪里——复用 `ctx.storage` 与 `storage-sqlite` 中枢，还是直接在 `<dshHome>/identity.sqlite` 打开私有 SQLite 文件？栅栏接受什么——纯回环、纯 bearer，还是「回环 OR bearer」？桌面主进程与本地 API 服务之间的令牌传输、密码哈希算法，都取决于这三个决策。

## 决策

xiaowei 远端后端 PR（10.1a）交付一个包 `packages/account/identity`（`@deepseek-ai/dsh-account-identity`），默认导出 `LocalIdentityProvider extends IdentityService`。`IdentityService` 是拥有 `ctx.identity` 的 Cordis `Service` 子类；`LocalIdentityProvider` 是仓库内唯一的具体实现。两种角色集中在同一个包，符合单包预发布立场——可自由改名 / 改包名 / 改 bundle 名，所有引用同步更新。

提供方通过 Node `node:sqlite` 的 `DatabaseSync` 直接打开 `<dshHome>/identity.sqlite`，设置 `journal_mode = WAL`、`PRAGMA application_id`、`PRAGMA user_version`，并确保父目录为 `0o700`、文件为 `0o600`。DDL 是两张表（`users` 含 `UNIQUE(email)`，`sessions` 含 `FK(user_id) ON DELETE CASCADE`）加上一个辅助索引。不走 `ctx.storage` 中枢：本机身份表的读写模式是「每次注册一行、每次会话一行」，`users` 与 `sessions` 通过 `user_id` 级联，通用 KV/JSON 存储无法干净地表达这种关系。DDL 模板来自 `packages/storage/storage-sqlite/src/schema.ts:43-50`。

线缆协议暴露四个非特权方法：`account.signup`、`account.signin`、`account.signout`、`account.state`。它们均**不**列入 `PRIVILEGED_METHODS`。`packages/client/connection/src/index.ts` 中的栅栏在 HTTP 与 WebSocket 升级路径上均改为 `!(isTrustedApiRequest(request, []) || isAuthenticatedApiRequest(request, ctx))`。`isAuthenticatedApiRequest` 读取 `Authorization: Bearer <token>`，调用 `ctx.identity.validate({ sessionToken })`，仅当服务解析出非空 `{ userId, displayName }` 时返回 `true`。因此信任表等价于「回环 OR 已知 bearer」。

密码使用 Node `crypto.scrypt` 哈希，参数 `N=16384, r=8, p=1`，16 字节 `randomBytes` 盐，64 字节派生密钥。磁盘格式编码参数：`scrypt$N=16384$r=8$p=1$<salt-base64url>$<hash-base64url>`。比较走 `crypto.timingSafeEqual`，绝不使用 `===`。遇到未知参数串时，提供方抛出 `IdentityError('BAD_REQUEST')`。

`LocalIdentityProvider` 公开：

- `signup({ email, password, displayName? }): { userId, sessionToken, displayName, expiresAt }` — 命中 `UNIQUE` 时返回 `EMAIL_TAKEN`
- `signin({ email, password }): { userId, sessionToken, displayName, expiresAt }` — 邮箱未知或密码错误均返回 `UNAUTHENTICATED`（同一错误码，不区分）
- `signout({ sessionToken }): { revoked: true }` — 对未知 token 幂等
- `validate({ sessionToken }): { userId, displayName } | null` — 已撤销、过期或未知 token 返回 `null`

`signout` 直接从 token 表中删除行。栅栏每次都同步读取实时 SQLite 行，因此撤销在下一个请求立即生效，无需失效缓存。

Bootstrap 默认 `{ email: '', password: '' }`（不创建管理员）。初始化时若 `users` 表为空**且** `bootstrap.email` 已配置，提供方沿用同一 scrypt 路径创建唯一一个管理员行，并记录一条 `INFO identity: bootstrap user created (email=...)`。在同一数据库上再次挂载**不会**重复 bootstrap；空表闸门保证即使 bootstrap 配置仍存在，也不会出现重复管理员行。默认空 bootstrap 保持注册通道开放。

桌面令牌传输（`apps/desktop/src/main/credential-store.ts`）把 `PersistedCredentials` 从 v2 升至 v3，新增可选 `sessionToken` / `userId` / `displayName` / `expiresAt` 字段。v3 读取器把缺失的旧字段视作空串（不是错误）——v2 文件就地升级到 v3，不会丢失之前的 `baseUrl`。`apps/desktop/src/main/api-client.ts` 新增 `setToken(t: string | null)`，当 `t !== null` 时在每次 `call()` / `respond()` 的 fetch 上附 `Authorization: Bearer <t>`；`setToken(null)` 清空请求头。

Electron 主进程 IPC 桥新增四个键（`getAuthState`、`signIn`、`signOut`、`subscribeAuthState`），由 `apps/desktop/src/shared/contracts.ts` 与 `apps/desktop/src/main/ipc-handlers.ts` 中的 `workbench:auth:*` 通道承载。登录成功时，handler 走 `credentialStore.save()` 写入、调用 `apiClient.setToken(result.sessionToken)`、向 renderer 广播 `AuthStateEvent`。renderer 通过 `apps/desktop/src/renderer/api.ts` 暴露 `api.auth.{getState,signIn,signOut,subscribe}`，并交付一个冷启动 `SignInCard` UI，提交时调用 `api.auth.signIn`。

WebSocket 特权路径（位于 `packages/client/connection/src/index.ts:181-190` 的 mux/host 升级）只保留 `isTrustedApiRequest`，不调用 `isAuthenticatedApiRequest`。WS 升级承载的是 server→client 事件流，并非用户方法调用，bearer 校验目前只能换来可观测性，不能换来安全边界。机制已就绪（connection 插件已注入 `identity`），下一个「按用户订阅事件」特性到来时即可启用，无须再动栅栏。

钱包（`WalletService`）与 `UserModelKeyService` 不在本 PR 中。`account.signup` 不分配 20 元 welcome 额度；`account.wallet.*` 与 `account.modelKeys.*` 线缆方法尚不存在。PR 2 第 10.1b 步将在 `signup` 末尾补 `provisionUserKey` + `setQuota(welcome)`。

## 考虑过的替代方案

**两个包：`account-identity`（Service Definition）+ `account-identity-local`（Provider）。** [Capability seams](../../implemented/architecture/2026-06-13-capability-seams.zh.md) 通常在 Service Definition 与 Service Provider 各自演化时拆包。`AGENTS.md` 的预发布立场一节允许在尚无第二个提供方时合并——当前仓库内没有第二个提供方。拆包意味着多一个 package、一份聚合注册、一组测试夹具，可观测行为没有任何变化。单包形态就是「折叠状态」的 seam；第二个提供方出现之日再拆分。

**身份走 `ctx.storage` 与 `storage-sqlite`。** 通用 KV/blob 存储无法表达 `users.email UNIQUE` 与 `sessions.user_id FK ON DELETE CASCADE`。要么用复合键编码，要么在身份包内重复索引逻辑，代码量都不少于直接写一份精简 DDL。`ctx.storage` 适合存放不透明 blob 和按 key 的文档；身份是有关系结构的，SQL 更合适。

**硬性禁止所有非回环调用方；通过绕过栅栏的 WebSocket 升级登录。** WS 升级本身已经是「回环或 trustedHosts」路径；把它变成唯一的认证路径会迫使桌面客户端在每次特权方法调用前再开一条旁路升级通道。LAN 前端需要公网侧终止 WS，这条路并不能推广。bearer 认证挂在既有的 HTTP 栅栏上，攻击面更小。

**`account.signup` 设为特权方法（需要管理员 bearer 才能创建用户）。** 首次部署与自托管 xiaowei 都没有「先有管理员」的前提。把 `account.signup` 设计成非特权方法，让新部署在没有离线 bootstrap 步骤的情况下也能完成首个注册。提供者内部的 bootstrap 路径覆盖「预置默认管理员」场景。后续按租户禁用 / 限流应放在未来的特权 `account.admin.*` 表面，而不是栅栏里。

**Argon2 / bcrypt 哈希。** 两者都引入新的原生依赖以及构建步骤或预编译二进制。`crypto.scrypt` 是 Node 标准库自带，引擎自带，且符合 FIPS。`N=16384` 是 OWASP 2023 给出的最低推荐；磁盘格式 `scrypt$N=...$...` 已把成本参数化，未来升级到 `N=2^17` 只改 verifier，不改协议。

**在进程内缓存 bearer token 以便栅栏亚毫秒判定。** 栅栏每次都对实时 SQLite 行做 PK 查询，单次成本是几百微秒。代价是 `account.signout` 与会话过期立即可见；缓存会引入「撤销到生效」之间的陈旧窗口，这是安全边界不可接受的。

**WebSocket 升级时校验 bearer。** 升级承载的是 server→client 事件流，不是用户方法调用。在升级上挂 `isAuthenticatedApiRequest` 只能换来可观测性——服务端最终还得把 `mux.subscribe(sessionId)` 与具体会话关联起来。机制已经就位；按用户订阅功能落地时再启用，不必由栅栏先发。

## 后果

`packages/account/identity` 是 xiaowei 部署下用户与会话行的唯一所有者。栅栏接受回环调用方（保持原样）以及会话 token 能解析为非空身份的 bearer 调用方。匿名 LAN 调用方可在没有 bearer 的情况下调用 `account.signup`、`account.signin`、`account.signout`、`account.state`；其它特权方法仍要求回环或 bearer。桌面客户端把 token 通过 `safeStorage` 加密的 v3 凭证持久化，每次 fetch 自动附上；清空 token 即清空请求头。

栅栏每次都读取实时 SQLite 行，因此撤销在下一个特权请求立即生效。成本是每个特权调用多一次 PK 查询（开发机上几百微秒）。这对 xiaowei 部署规模可接受；如果后续压力曲线显示需要，再加一层 30 秒 `last_seen_at` 写穿透缓存。

PR 2 第 10.1b 步（wallet + model-keys）将交付 `WalletService` 与 `UserModelKeyService`，沿用相同的「定义 + 提供方」形态拆分。`signup` 将在现有事务末尾补 `provisionUserKey` + `setQuota(welcome)`。线缆将新增 `account.wallet.*` 与 `account.modelKeys.*`，在公开读表面被证立之前一律走特权-回环限定。

## 验证

- `packages/client/connection/tests/api-request-auth.spec.ts` — 八条 `extractBearerToken` 用例（合法请求头、首尾空白、Headers 对象、缺失请求头、非 Bearer scheme、空 token、多值请求头、scheme 大小写不敏感）与五条 `isAuthenticatedApiRequest` 用例（活 token、缺失请求头、缺失服务、`validate` 返回 null、`validate` 抛错）。
- `scripts/xiaowei/sanity-account-signup.mjs` — 在真实磁盘 SQLite 上的十一步：DDL 落地、注册、重复邮箱 `EMAIL_TAKEN`、密码错误 `UNAUTHENTICATED`、邮箱未知 `UNAUTHENTICATED`、登录发新 token、两个活 token 都能验证、登出撤销第一个、第二个仍可用、幂等登出、提供方重启后 token 仍可用。
- `scripts/xiaowei/sanity-bootstrap-user.mjs` — 四步：空 bootstrap 部署拒绝登录、配置 bootstrap 后创建管理员、再次挂载**不会**重新 bootstrap、空 bootstrap 保留注册通道。
- `scripts/xiaowei/sanity-fence-relaxation.mjs` — 在真实 Node `http.Server` 上的七步：回环调用方通过栅栏、trusted host 无 token 返回 403、trusted host + 有效 bearer 通过栅栏、trusted host + 篡改 bearer 返回 403、trusted host + 已撤销 bearer 返回 403、畸形 Authorization 返回 403。

## 推迟

- Wallet（`WalletService`）与 `UserModelKeyService` — PR 2 第 10.1b 步。
- `account.wallet.setQuota` / `account.admin.*` 特权-回环限定方法 — 随 wallet 包一并落地。
- WebSocket bearer 校验 — 随按用户订阅事件特性落地。
- Linux `secret-service` 在 `safeStorage` 不可用时的降级 — 超出范围；当前基线在缺失后端时直接抛错。
- 栅栏的 `last_seen_at` 写穿透缓存 — 若 xiaowei 部署压力曲线显示需要再加入。

## 相关

- [Capability seams — Service Definition / Service Provider / Consumer roles](../../implemented/architecture/2026-06-13-capability-seams.zh.md)
- `packages/account/identity/` — 已交付的包
- `packages/client/connection/src/api-request-auth.ts` — bearer 提取 + 身份校验
- `packages/client/connection/src/index.ts` — 已放宽的栅栏
- `apps/desktop/src/main/credential-store.ts` — v3 schema 与 `safeStorage` 升级路径
- `apps/desktop/src/main/api-client.ts` — `setToken` 与 Authorization 请求头