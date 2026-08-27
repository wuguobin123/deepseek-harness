# Agent Note: xiaowei 账户 seam——身份、邮箱验证、钱包、用户模型密钥

Status: implemented

[English](2026-08-24-xiaowei-account-seam.md) | 中文

## 问题

xiaowei 多用户表面需要四个相互协作的原子能力：

1. **身份**——具有密码登录、服务端签发会话令牌、登出即撤销语义的持久用户。没有它就没有按用户隔离、没有欢迎额度链、也没有栅栏豁免。
2. **邮箱验证**——注册必须验证邮箱可达（防滥用、防打错）；经典的 6 位数字码，带 TTL、重发冷却、锁定窗口。
3. **钱包**——以微（micros）为单位的用户余额，带完整账本用于审计；注册必须赠送 20 元欢迎额度；运维必须能充值与设置配额。
4. **用户模型密钥**——按用户的新-api 协议 API key；使用来自 env 的主密钥加密存储，明文只在签发时暴露一次。

每一项都至少有一种明显的错误形态：单一共享 SQLite 中心不能匹配访问模式；引入外部身份提供方会给每次特权请求带来一次 HTTP 往返；第三方的密码哈希库为 Node stdlib 也能做的事引入了一个依赖。下文给出实际交付的形态及其理由。

## 决策

四个 Cordis `Service`，由 `dsh-xiaowei` 挂载为 `DSH_HOME` 下的四个单文件 SQLite 存储。Pre-release 立场下：每个 Service Definition **与**其唯一具体实现位于同一个包中；没有 `*-local` 兄弟包。栅栏门为 `loopback OR trustedHosts OR isAuthenticatedApiRequest`；最后一个谓词在本次 PR 中新增，并在 [`2026-08-24-xiaowei-bundle-and-trust-fence.md`](2026-08-24-xiaowei-bundle-and-trust-fence.zh.md) 中记述。`account.signup` 的触发链是 `welcome credit → provision user model key → return`，密钥签发是尽力而为，因此即便密钥存储暂时失败也不会回滚注册。

### 1. 身份

`packages/account/identity/` 导出 `IdentityService`（抽象）和 `LocalIdentityProvider`（默认导出具体）。一个 SQLite 文件 `<dshHome>/identity.sqlite`，`journal_mode = WAL`，文件权限 `0o600`，父目录 `0o700`，`SCHEMA_VERSION = 1`。两张表：

- `users(user_id PRIMARY KEY, email UNIQUE, password_hash, display_name, created_at)`
- `sessions(token PRIMARY KEY, user_id FK ON DELETE CASCADE, created_at, expires_at, last_seen_at, user_agent)`

密码哈希：Node stdlib `crypto.scrypt`，参数 `N=16384, r=8, p=1`，16 字节 salt，64 字节 hash。存储格式 `scrypt$N=16384$r=8$p=1$<salt-base64url>$<hash-base64url>`。比较通过 `crypto.timingSafeEqual`，绝不 `===`。令牌格式 `randomBytes(32).toString('base64url')`。

`LocalIdentityProvider.signup()` 执行：schema 检查 → 可选的邮箱验证门（当 `ctx.emailVerification.enabled`）→ 创建用户 → 签发会话 → 触发欢迎额度 → 签发用户模型密钥（尽力而为）→ 返回 `SignedIn`。Bootstrap：若 `users` 为空 **且** `XIAOWEI_ADMIN_EMAIL`/`XIAOWEI_ADMIN_PASSWORD` 已配置，则在 `[Service.init]` 阶段创建该用户并记录 INFO；空 users + 空 bootstrap 是正常的启动状态。

### 2. 邮箱验证

`packages/account/email-verification/` 导出 `EmailVerificationService` 和 `LocalEmailVerificationProvider`。复用 `identity.sqlite`（一张表 `email_verification_codes`），因此运维生命周期与用户表绑定；`wallet.sqlite` 与 `user-model-keys.sqlite` 故意分开（见 §3、§4）。

- 6 位数字码，10 分钟 TTL，60 秒重发冷却，5 次错误后 30 分钟锁定，每小时最多发送 10 次。
- 哈希：`crypto.pbkdf2Sync('sha256', 200_000 iterations, salt=16B, keylen=32B)`。6 位搜索空间足够小，PBKDF2 的代价可以接受；scrypt 留给密码使用。
- EmailSender 抽象，两个实现：`LoggingEmailSender`（默认；在 stderr 上以 WARN 级别打印明文，桌面 CDP 探针可以 grep 到）与通过 `nodemailer` 实现的 `SmtpEmailSender`。
- ESC 通道：`config.enabled = false`（`XIAOWEI_EMAIL_VERIFICATION=false`）跳过建表、跳过 `signup()` 内的验证门以及整个 wire 方法；路由保持编译，但处理器返回明确的 `VERIFICATION_DISABLED` 码。
- 错误码：`WRONG_CODE` / `CODE_EXPIRED` / `CODE_LOCKED` / `CODE_NOT_FOUND` / `EMAIL_INVALID` / `RESEND_COOLDOWN` / `RATE_LIMIT_EXCEEDED`。Wire 映射：前五个 → `code: 'bad-request'`（HTTP 400）；后两个 → `code: 'too-many-requests'`（HTTP 429）。

### 3. 钱包

`packages/account/wallet/` 导出 `WalletService` 和 `LocalWalletProvider`。独立 SQLite 文件 `<dshHome>/wallet.sqlite`，`SCHEMA_VERSION = 1`。两张表：

- `wallets(user_id PRIMARY KEY, balance_micros, updated_at, created_at)`
- `wallet_ledger(id PK AUTOINCREMENT, user_id, delta_micros, reason, balance_after, created_at, idempotency_key NULL)`，附 `UNIQUE(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL`。

单位 `balance_micros / 1_000_000 = CNY`，与 my-agents Python 端的约定一致；UI 通过 `Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' })` 转换。Config 默认值：`welcomeBonusMicros: 20_000_000`（20 元）、`dailyRefreshMicros: 5_000_000`（5 元）。`credit()` / `debit()` 在 `BEGIN IMMEDIATE` 事务内执行，包住 `UPDATE wallets` + `INSERT ledger`；当行会变成负数时 `debit()` 抛出 `INSUFFICIENT_BALANCE`。每日刷新使用 `idempotencyKey = 'YYYY-MM-DD'`，UNIQUE 索引保证同一天二次调用为 no-op。

### 4. 用户模型密钥

`packages/account/model-keys/` 导出 `UserModelKeyService` 和 `LocalUserModelKeyProvider`。独立 SQLite 文件 `<dshHome>/user-model-keys.sqlite`，`SCHEMA_VERSION = 1`。一张表 `user_model_keys(key_id PK, user_id, key_value_encrypted, label, created_at, last_used_at, revoked_at)`。

- `provision({ userId })` 生成可见 key id 为 `mk_` + 16 hex，32 字节 secret 字符串化为 `base64url`。secret 使用 AES-256-GCM 加密（主密钥 = `XIAOWEI_MASTER_KEY` env，32 字节 base64url）；`[Service.init]` 阶段校验主密钥，缺失时大声失败（`MASTER_KEY_NOT_CONFIGURED`）。
- 明文 `keyValue` 恰好在 `provision()` 响应中返回一次。`list()` / `get()` 只返回 `keyId` + 元信息。secret 不会被再次存储、记录或返回。
- `revoke({ keyId })` 写入 `revoked_at`；之后的 `provision()` 调用不会复用旧 key id。

### 栅栏（委托给 bundle 笔记）

`account.signup` / `account.signin` / `account.signout` 不在 `PRIVILEGED_METHODS` 中。它们由 `isTrustedApiRequest`（loopback 或 `trustedHosts`）把关，且仅在 `account.signout` 上额外要求有效的 `Authorization: Bearer <token>`；`signup`/`signin` 本身就是签发令牌的端点。

`account.wallet.credit` / `account.wallet.setQuota` / `account.modelKeys.provision` / `account.modelKeys.revoke` 为 loopback-only（特权方法）。`account.wallet.get` / `account.modelKeys.list` 接受 bearer，但要求 `userId === token.userId`（跨用户读返回 403）。

## 备选方案

- **Argon2 / bcrypt 密码哈希**——拒绝；8 字符最低的密码成本-依赖权衡不可接受。Node `crypto.scrypt` 是 stdlib，具备同样的内存硬性，且 `crypto.timingSafeEqual` 覆盖了常量时间比较。
- **`bcrypt` / `argon2id` 用于邮箱验证码的外部依赖**——拒绝；6 位搜索空间下 PBKDF2 20 万次迭代足够，避免了并行的哈希库。更强的保证对该 10 分钟 TTL 来说属于浪费。
- **单一 SQLite 文件承载三者（身份 + 钱包 + 模型密钥）**——拒绝；`wallet` 与 `user-model-keys` 与身份有不同的运维生命周期（轮换、备份粒度、审计窗口），跨 `users` + `wallets` 的 `BEGIN IMMEDIATE` 是不应承担的耦合。`email-verification` 复用 `identity.sqlite`，因为其生命周期与用户表绑定。
- **外部身份提供方（Auth0 / Supabase / Keycloak）**——拒绝；每次特权请求的 HTTP 往返是不可持续的成本。令牌撤销保证（立即、同步 SQLite 查询）是信任模型的核心属性，必须保持在进程内。
- **JWT 签名令牌**——拒绝；不透明的服务端签发令牌在每次栅栏检查时被 `SELECT` 命中 `sessions`，以一次索引 PK 查询的代价换得立即撤销。JWT 的撤销故事是「等过期」或者无论如何都要维护一份 deny list。
- **`password_hash` / `password_verify` PHP 风格库**——拒绝；同 Node stdlib 论证。scrypt 的编码包含参数，未来升级参数是 verify 兼容的升级。
- **允许 bearer 认证绕过 `trustedHosts`**——拒绝；栅栏是分层的。trusted-hosts 是可达性（哪些部署可以与本主机通信）；bearer 认证是身份（哪个用户在调用）。两层组合：非受信来源仍需有效令牌，受信来源无令牌仍可通行。

## 影响

### 收益

- **独立性**——每个 Service 拥有一个文件；备份粒度、WAL 生命周期、释放顺序按 Service 划分。
- **零新运行时依赖**——`crypto.scrypt`、`crypto.pbkdf2Sync`、`crypto.createCipheriv('aes-256-gcm')`、`crypto.timingSafeEqual`、`node:sqlite`。唯一新增依赖是 `nodemailer`（用于 SMTP，一个 workspace 依赖，可选）。
- **立即撤销**——`account.signout` 是删除行；栅栏在每次特权请求时检查该行。
- **单一部署产物**——一次 `pnpm dsh --profile xiaowei` 启动全部四个 Service，不需要外部身份提供方。
- **运维受限的额度**——20 元欢迎额度、5 元每日刷新，按天幂等；运维通过 loopback 设置配额。

### 代价

- **每次请求的栅栏查找**——每次特权请求对 `sessions` 做一次索引 PK 查询。可接受；未缓存。未来缓存必须保持撤销保证。
- **注册时尽力而为的密钥签发**——若 `user-model-keys.provision` 在钱包入账后失败，用户已创建并入账但没有密钥。桌面 UI 显式提示；用户在设置中重试 `account.modelKeys.provision`。缓解措施：记录 WARNING，不回滚注册，因为回滚一个已经看到欢迎界面的用户的体验，比请用户重试创建密钥更差。
- **`MASTER_KEY` 轮换需要重新加密**——AES-GCM 密文使用单一主密钥。轮换是一次手动 `UPDATE user_model_keys SET key_value_encrypted = reencrypt(key_value_encrypted, OLD_KEY, NEW_KEY)` 然后切换 env；本次 PR 未自动化。
- **WS bearer 认证不在范围内**——只有 HTTP 一元方法按令牌校验。`events.mux` / `events.host` 的 WebSocket 下行流仅 trusted-host；按用户事件订阅是未来 PR。
- **Linux 桌面 `safeStorage` 不可用**——桌面凭证存储在 Linux 无 secret-service 时仍然报错。这些主机的令牌不会被持久化；用户每次启动都要登录。未来 PR。
- **`account.emailCode` 经栅栏可达任意 LAN 调用者**——本次 PR 没有基于 IP 的限速。未来 PR 增加按 IP 限速 + Turnstile。
- **`account.signup` 暴露给 LAN 调用者**——任何通过 `trustedHosts`（loopback + 公网 IP）的来源都能创建账户。本次 PR 没有仅管理员注册模式；`account.admin.*` 特权集是未来 PR。