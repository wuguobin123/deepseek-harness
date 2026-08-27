# `@deepseek-ai/dsh-account-email-verification`

[English](README.md) | 中文

用于 xiaowei 注册的邮箱验证码 seam。挂载为 `ctx.emailVerification`；`packages/host/apiproxy/src/api/account.ts` 中的协议方法从 `account.signup`（验证）和 `account.emailCode`（发送）调用它。

## 行为

| 方法 | 用途 | 错误 |
| --- | --- | --- |
| `requestCode({ email, purpose?, invitationId? })` | 生成并发送绑定到一个用途和分享码的 6 位验证码 | `EMAIL_INVALID`、`CODE_LOCKED`、`RATE_LIMIT_EXCEEDED`、`RESEND_COOLDOWN`、`EMAIL_VERIFICATION_DISABLED` |
| `verifyCode({ email, code, purpose?, invitationId? })` | 验证并仅删除匹配的绑定验证码 | `EMAIL_INVALID`、`CODE_NOT_FOUND`、`WRONG_CODE`、`CODE_EXPIRED`、`CODE_LOCKED` |

可调参数（以下为默认值）：

| 配置 | 默认值 | 作用 |
| --- | --- | --- |
| `enabled` | `true` | 总开关；`false` 使 `verifyCode` 不执行任何操作 |
| `ttlSeconds` | `600` | 验证码有效期 |
| `resendCooldownSeconds` | `60` | 向同一邮箱发送两次验证码的最短间隔 |
| `maxSendsPerHour` | `10` | 每个邮箱的滚动发送上限 |
| `maxAttemptsBeforeLock` | `5` | 错误验证码次数阈值 |
| `lockoutSeconds` | `1800` | 达到阈值后的锁定时长 |
| `transportKind` | `logging` | 发送方；生产环境使用 `smtp` |

## 发送方

- `LoggingEmailSender`：默认。向 Cordis logger 发出 `email-verification: code sent email=… code=…` 警告，使开发环境和 CI 能读取验证码。
- `SmtpEmailSender`：通过 `nodemailer` 与真实 SMTP 服务器通信。惰性加载；未配置 SMTP 的部署无需承担模块初始化成本。

## 存储

独立 SQLite 文件位于 `<path>/email-verification.sqlite`（默认为 `<dshHome>/email-verification.sqlite`）。`email_verification_codes` 表以规范化邮箱、用途和分享码标识作为联合键。错误次数、锁定、过期和删除仅作用于对应记录；每小时发送上限仍汇总同一邮箱的所有有效分享码。明文验证码绝不写入磁盘，只存储 PBKDF2-HMAC-SHA256 哈希。

## 协议代码

`packages/host/apiproxy/src/api/rpc.ts` 增加：

- `email-invalid`
- `verification-code-required`
- `wrong-verification-code`（含 `remainingAttempts`）
- `verification-code-expired`
- `verification-code-locked`（含 `retryAfterSeconds`）
- `too-many-requests`（含 `retryAfterSeconds`）

`apps/desktop/src/renderer/features/auth/SignInCard.tsx` 中的 SignInCard 根据这些代码显示正确的行内消息和倒计时。

## 模型体验

无。账号验证在 Agent 执行前完成，不注册提示词、工具或模型可见结果。

#### KV Cache 影响

无。验证值绝不进入模型请求。

## 已知限制与后续工作

- **SMTP 投递由部署方负责。** 日志发送方会把验证码写入开发日志，不能作为生产传输方式。
- **验证码只有一种渠道。** 密码找回和其他验证渠道不在本包范围内。
