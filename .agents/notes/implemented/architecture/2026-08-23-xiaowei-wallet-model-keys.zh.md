# Agent Note: xiaowei 钱包 + 模型密钥 + 邮箱验证码 包

Status: implemented

[English](2026-08-23-xiaowei-wallet-model-keys.md) | 中文

## 问题

xiaowei 能力层（xiaowei 计划的 PR 2）需要三个账户侧的新包，原 PR 2 第 10.1a 步延后落地：

- **钱包**：以 CNY（单位为 micros，`balance_micros / 1_000_000 = CNY`） 追踪每位用户的余额；支持 welcome bonus、每日刷新、管理员改写额度、 完整的审计 ledger。参考 my-agents `model_accounts.py:1139-1203` （`set_wallet_quota`）。
- **用户模型密钥**：为每位用户发放一个 `mk_<…>` 标识与一个 `sk_<…>` 明文密钥，用 AES-256-GCM 把密钥静态加密，支持吊销与重新发放，密钥 来自主密钥。参考 `model_accounts.py:441-517`（`provision_user_key`）。
- **邮箱验证码流程**：6 位数字码、10 分钟 TTL、60 秒重发冷却、5 次错误 锁定 30 分钟；在启用时为 `account.signup` 设门。参考 `email_verification.py`。

需要事先决定三件事：

1. 抽象 Service Definition 与其唯一实现是否合在一个包内（pre-release stance）。
2. SQLite 文件是否复用 `identity.sqlite`，还是按关注点拆成独立文件。
3. `provision()` 是否仅一次性返回明文密钥值（后续只返元信息），主密钥 `XIAOWEI_MASTER_KEY` 的注入方式。

## 决策

### 单包：抽象 + 实现合一

三个包 `packages/account/email-verification/`、 `packages/account/wallet/`、`packages/account/model-keys/` 均把抽象 Service Definition 与唯一 SQLite 实现合在同一 `*.ts`，默认导出为具体 类。沿用 `packages/account/identity/` 与 `packages/session/session-persistence-sqlite/` 的 pre-release stance。 Loader 选默认导出；将来出现第二个 provider 时，会以同级包形式出现， 自带不同默认类与 `cordis.yml` 行。

### 各关注点独立 SQLite 文件

| 包 | 路径 | `SCHEMA_VERSION` | `APPLICATION_ID` |
|---|---|---|---|
| `identity` | `<dshHome>/identity.sqlite` | 1 | 独立 |
| `email-verification` | 复用 `identity.sqlite`（DDL 追加） | n/a（加表） | 共享 |
| `wallet` | `<dshHome>/wallet.sqlite` | 1 | 独立 |
| `user-model-keys` | `<dshHome>/user-model-keys.sqlite` | 1 | 独立 |

`email-verification` 复用 identity 文件：行生命周期短（分钟到小时）， 且是 `account.signup` 的旁路通道；拆库会带来跨库 FK 语义却无操作收益。 钱包与密钥库独立成文件，因为它们是财务 / 凭据类材料，生命周期长， 备份与轮换要求各不相同——独立文件允许单独清空密钥库而不影响用户名单。

### 单位：micros，不上浮点

`WalletView.balanceMicros` 是 `number`，单位 micros。1 000 000 micros = 1.00 CNY。线上无浮点运算；渲染端用 `Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' })` 换算。单位名称写入所有错误消息与 ledger 列名。

### Ledger 唯一性走部分索引

```sql
CREATE UNIQUE INDEX IF NOT EXISTS wallet_ledger_idem
  ON wallet_ledger(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
```

`refreshDaily({ userId, idempotencyKey: 'YYYY-MM-DD' })` 在 `BEGIN IMMEDIATE` 事务内写 ledger 行；同 key 二次调用要么命中（无副作用， 返回当前余额）、要么撞 `SQLITE_CONSTRAINT_UNIQUE`（调用方收到 `DUPLICATE_REFRESH`）。每日刷新因此对 `(userId, date)` 是 exactly-once。

`debit()` 余额不足在同事务内抛 `WalletError('INSUFFICIENT_BALANCE')`； 隐式回滚撤销行写入，审计日志永不记录负余额。

### 密钥静态加密

`LocalUserModelKeyProvider.provision({ userId })`：

- 生成 `mk_<16 hex>` 与 `key_value = randomBytes(32).toString('base64url')`。
- `key_value` 用 `crypto.createCipheriv('aes-256-gcm', masterKey, iv12)` 加密，按 `iv || tag || ciphertext` 单 BLOB 入库。
- 返回 `{ keyId, userId, label, createdAt, keyValue }` —— 明文仅现一次， 在调用方拿到响应时即被消费。
- `list({ userId })` 只返 `{ keyId, userId, label, createdAt, lastUsedAt, revokedAt }`，永不返 keyValue。
- `revoke({ keyId })` 写 `revoked_at`；同用户后续 `provision()` 分配新 key id（槽位已释放）。
- 缺失 `XIAOWEI_MASTER_KEY` 在首次 `provision()` 处 fail loud： `ModelKeyError('MASTER_KEY_NOT_CONFIGURED', …)`，无静默 fallback。

### `LoggingEmailSender` 捕获机制

email-verification provider 暴露结构化 `SenderLogger`（`info` / `warn`）。`LoggingEmailSender` 是 `transportKind !== 'smtp'` 时的默认 fallback；`SmtpEmailSender` 走懒构造——无 SMTP 配置时根本不会 `import('nodemailer')`。`enabled: false` 让 `requestCode` 抛 `EMAIL_VERIFICATION_DISABLED`、`verifyCode` 走 pass-through 返回 `true`，让运营者无需改代码即可关闭整条 seam。

### Cordis bundle 接入

`packages/bundle/ops/cordis.patch.yml` 与 `packages/bundle/web-app/cordis.patch.yml` 在已有 `identity` 行后追加 三行：

- `email-verification` 读 `XIAOWEI_SMTP_HOST` env；已设则走 SMTP， 否则走 logging。`XIAOWEI_EMAIL_VERIFICATION=false` 关停整条 seam。
- `wallet` 配置 `welcomeBonusMicros: 20_000_000`、 `dailyRefreshMicros: 0`（默认不启用；可通过 `XIAOWEI_DAILY_REFRESH_MICROS` 显式开启）。
- `user-model-keys` 读 `XIAOWEI_MASTER_KEY`（32 字节 base64url）。

`connection` 行的 `inject` 列表扩展为 `[webRuntime, identity, emailVerification, wallet, userModelKeys]`。

### Wire 方法与 fence

`packages/host/apiproxy/src/api/account.ts` 暴露：

- `account.emailCode`（公共，非 privileged；信任调用方但由 seam 限速： cooldown + 每小时上限）。
- `account.wallet.{get,credit,debit,setQuota,refreshDaily, grantWelcomeBonus,listLedger}` —— `credit` / `debit` / `setQuota` / `refreshDaily` / `grantWelcomeBonus` **loopback-only**；`get` 与 `listLedger` **loopback OR bearer**，校验 `userId === token.userId`。
- `account.modelKeys.{provision,list,revoke}` —— `provision` / `revoke` **loopback-only**；`list` **loopback OR bearer**，同上。

`IdentityError` / `WalletError` / `ModelKeyError` / `EmailVerificationError` 经 `errorToRpc()` 投影为 `{internal, bad-request, too-many-requests, unauthenticated, forbidden}` 之一。`INSUFFICIENT_BALANCE` → `bad-request`；`WRONG_CODE` / `CODE_EXPIRED` / `CODE_LOCKED` / `CODE_NOT_FOUND` → `bad-request`； `RESEND_COOLDOWN` / `RATE_LIMIT_EXCEEDED` → `too-many-requests`。

### Sanity 脚本

`scripts/xiaowei/{sanity-wallet-quota,sanity-model-keys, sanity-email-code}.mjs` 在临时目录下用真实磁盘 SQLite 跑端到端：

- `sanity-wallet-quota`：新用户零余额 → setQuota → credit → debit → 超额 → 每日刷新幂等 → listLedger 最新优先 → 重启持久化 → 对新用户 触发 welcomeBonus。
- `sanity-model-keys`：provision → 二次 provision `KEY_REVOKED` → list（无明文泄露）→ revoke → list 显示 `revokedAt` → reprovision → revoke(unknown) → revoke(revoked) → 重启持久化 → 空 master key `MASTER_KEY_NOT_CONFIGURED`。
- `sanity-email-code`：requestCode ttl + retryAfter → 重发 cooldown → 5 次错码 `CODE_LOCKED` → 锁定中正确码仍锁 → 验证成功删行 → TTL 过期 → 未知邮箱 `CODE_NOT_FOUND` → 关闭 seam pass-through。

脚本依赖工作区包；`scripts/package.json` 与 `pnpm-workspace.yaml` 把 `scripts` 加入工作区成员，使 `pnpm exec tsx scripts/xiaowei/sanity-*.mjs` 通过工作区符号链接解析包。 `Branded<UserId>` brand 在脚本边界用纯字符串转 helper（brand 是类型而非 函数，`@deepseek-ai/dsh-brand` 只导出类型）。

## 备选方案

**抽象与实现拆包**（如 `account-wallet` + `account-wallet-local`）。已 拒：pre-release stance；本仓库已按同一规则发单包 Service Definition； 无现成 consumer 需要第二个 provider。

**复用 `identity.sqlite` 承载 wallet + model-keys**。已拒：财务 / 凭据 类材料有独立的备份 / 清空语义；合库后无法独立轮换密钥库，且 SQLite WAL checkpoint 顺序变模糊。

**线上 `balanceCny` 用浮点**。已拒：浮点 JSON 丢精度（`0.1 + 0.2 ≠ 0.3`）；渲染端用 `Intl` 从 micros 整数换算。Micros 是单位，CNY 是呈现。

**明文 key value 写入 `key_value` 列**。已拒：运维人员拷贝文件到备份 介质时直接看到密钥。AES-GCM 把明文挡在不持有主密钥的层之外。

**provision 每次读取都返 key value**。已拒：审计日志或仪表盘若调用 `list()` 即掌握明文，扩大泄露面。明文仅在 `provision()` 这一次现身； 后续读取只有元信息。

**生产用进程内 `logging` 传输**。可接受但已主动降级：未配 SMTP env 时 `LoggingEmailSender` 是默认 fallback，面向 dev / CI。生产部署应配置 `XIAOWEI_SMTP_HOST` 等，bundle patch 改走 `SmtpEmailSender`。

**引入 argon2 / bcrypt 依赖做密码 / 验证码哈希**。已拒：pre-release stance 倾向 Node stdlib（密码 `crypto.scrypt`、验证码 `crypto.pbkdf2Sync` 200 000 轮）——所选参数已够用，且避免新增传递性供应链面。

## 影响

- 各关注点独立 SQLite 文件，DDL 小，备份独立，dispose 顺序显式（每个 provider 各自 yield `store.close()` 释放器）。
- `Branded<UserId>` 是 wire seam 的 brand；sanity 脚本在调用方做纯字符 串转，因为 `@deepseek-ai/dsh-brand` 的 `Branded` 是类型而非函数。
- `LoggingEmailSender` 的构造期就按引用捕获 `ctx.logger`；测试捕获必须 在 `ctx.plugin(...)` **之前**替换 `ctx.logger.warn` —— 插件加载后再 安装已晚（sender 已快照原 logger）。
- wallet / model-keys provider 各持一个 `node:sqlite` 句柄；同用户 并发 `credit` / `debit` 由 SQLite 库级写锁 + `BEGIN IMMEDIATE` 串行化。
- API key 明文仅现一次于 provision；UI 流若需展示（如「复制到剪贴板」 按钮）必须紧跟 wire 响应立即消费，不得从 `list` 再取。
- `XIAOWEI_MASTER_KEY` 轮换需重加密迁移：schema 预留 `master_key_version` 字段供未来 bump；本 PR 不实现轮换。
