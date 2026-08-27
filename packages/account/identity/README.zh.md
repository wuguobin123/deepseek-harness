# @deepseek-ai/dsh-account-identity

[English](README.md) | 中文

xiaowei 多用户部署的本地身份提供方：支持账户注册、登录、退出、不透明 bearer token，以及挂载为 `ctx.identity` 的 `IdentityService` Service Definition。预发布阶段使用单包方案：抽象 `IdentityService` 和唯一的 `LocalIdentityProvider` 位于同一包；托管 IdP 会拆分此 seam。

## 磁盘格式

`<dshHome>/identity.sqlite` 仅所有者可访问（`0o600`），父目录也仅所有者可访问（`0o700`），SQLite 使用 `journal_mode = WAL`。schema 版本位于 `PRAGMA user_version`；应用 id `0x44534849`（`DSHI`）写入 `PRAGMA application_id`，防止其他工具占用该文件。

包含三个表：

- `users(user_id, email UNIQUE, password_hash, display_name, created_at)`
- `sessions(token PRIMARY KEY, user_id FK → users ON DELETE CASCADE, created_at, expires_at, last_seen_at, user_agent)`
- `invitations(invitation_id, owner_id, code_digest UNIQUE, code_suffix, code_ciphertext, created_at, expires_at, consumed_at, redeemed_by)`；摘要用于验证兑换，认证加密使有效分享码可以继续提供给其所有者。

分享码落盘时使用 AES-256-GCM。加密密钥通过 HKDF-SHA256 从 `invitationPepper` 派生并使用分享码专用的域分离，关联数据将密文绑定到分享码标识和所有者标识。SQLite 绝不存储分享码明文。

密码哈希使用 Node `crypto.scrypt`（不增加依赖）：

```
scrypt$N=16384$r=8$p=1$<salt-base64url>$<hash-base64url>
```

`salt` 为 16 个随机字节，`hash` 为 64 个字节。编码形式携带 `N/r/p` 三元组，使未来迁移可以用更高成本重新验证，而不会拒绝已有记录。

会话 token 是 32 个随机字节的 urlsafe-base64。它们不是 JWT：没有签名密钥，每次撤销都删除一条记录，`validate()` 直接读取记录。

## 服务接口

```ts
import { Service } from '@deepseek-ai/cordis'
import type { AuthenticatedView, InvitationId, InvitationView, SessionToken, SignedIn, UserId } from '@deepseek-ai/dsh-account-identity'

declare module '@deepseek-ai/cordis' {
  interface Context { identity: IdentityService }
}

abstract class IdentityService extends Service {
  abstract signup(input: { email: string; password: string; displayName?: string; invitationCode: string }): Promise<SignedIn>
  abstract inspectInvitation(input: { code: string }): Promise<{ invitationId: InvitationId }>
  abstract createInvitation(input: { ownerId: UserId }): Promise<InvitationView & { code: string }>
  abstract listInvitations(input: { ownerId: UserId }): Promise<InvitationView[]>
  abstract rotateInvitation(input: { ownerId: UserId; invitationId: InvitationId }): Promise<InvitationView & { code: string }>
  abstract signin(input: { email: string; password: string }): Promise<SignedIn>
  abstract signout(input: { sessionToken: SessionToken }): Promise<{ revoked: true }>
  abstract validate(input: { sessionToken: SessionToken }): Promise<AuthenticatedView | null>
}
```

配置包含 `invitationPepper`（邀请 HMAC 密钥）、`maxUsers`（100）、`maxInvitationsPerUser`（3）和 `invitationTtlSeconds`（604800）。pepper 同时提供兑换 HMAC 密钥和独立派生的加密密钥。未提供 pepper 时，会在数据库旁原子创建 32 字节、仅所有者可读的密钥文件；内存数据库使用临时密钥。注册在一个 `BEGIN IMMEDIATE` 事务中同时重检容量、兑换邀请并插入用户。

`LocalIdentityProvider` 在 `[Service.init]` 中打开数据库，在 `users` 为空时创建引导管理员，并通过同一个句柄提供所有方法。没有进程内缓存，因此撤销会立即传播。

## 协议方法

`packages/host/apiproxy/src/api/account.ts` 公开：

- `account.signup({ email, password, displayName?, invitationCode })` → `{ userId, displayName, sessionToken, expiresAt }`
- `account.emailCode({ email, invitationCode })` → 绑定分享码的邮箱验证码有效期与重试时间
- `account.invites.create({})` → 当前账号拥有的元数据和新生成分享码的完整值
- `account.invites.list({})` → 当前账号拥有的元数据，以及每个有效、未使用且存在加密值的分享码完整值
- `account.invites.rotate({ invitationId })` → 替换一个有效分享码且不消耗新的终身名额，并返回新生成的完整值
- `account.signin({ email, password })` → 相同字段
- `account.signout({ sessionToken })` → `{ revoked: true }`
- `account.state({ sessionToken })` → `{ userId, displayName, expiresAt } | { signedIn: false }`

注册、邮箱验证码和登录只在通过 Host/可信 authority 检查后公开；注册仍必须提供有效分享码。分享码创建、列表和重新生成要求通过验证的账号 Bearer，并从该 principal 派生所有者。列表不会返回已使用、已过期或旧版仅摘要记录的明文。重新生成要求所有者明确操作，会使被替换的值失效，且不会新增分享码记录。宿主管理方法仍仅限 loopback。

密码错误和账户不存在时，`signin` 返回相同的协议代码（`UNAUTHENTICATED`）和相同消息；区分二者会泄露邮箱探测接口。

## 组合

组合包配置项使用其配置挂载提供方：

```yaml
- id: identity
  name: '@deepseek-ai/dsh-account-identity'
  config:
    path: !!js dshHomePath('identity.sqlite')
    maxUsers: 100
    maxInvitationsPerUser: 3
    invitationTtlSeconds: 604800
    bootstrap:
      email: !!js process.env.XIAOWEI_ADMIN_EMAIL || ''
      password: !!js process.env.XIAOWEI_ADMIN_PASSWORD || ''
```

信任防护的 connection 配置项必须注入提供方：

```yaml
- id: connection
  inject: [webRuntime, identity]
```

`packages/client/connection/src/api-request-auth.ts` 读取 `Authorization: Bearer …` 并通过 `ctx.identity.validate()` 验证；有效 token 与已有的仅限 loopback 的 `isTrustedApiRequest(request, [])` 快捷路径一样，可以通过特权方法检查。

## 模型体验

无。该提供方认证 Host 请求，不会进入模型请求正文或提示词。

#### KV Cache 影响

无。token 不会进入提示词；它们仅附加到模型不可见的出站 HTTP 请求头。

## 已知限制与延后工作

- **scrypt N=16384 是 Node 标准库的最低值**：未来迁移可以提高 N（参数包含在编码哈希中），但必须提供同时接受新旧记录的验证路径。
- **邀请注册受配置的用户规模限制**：后续 PR 会为封禁、停用和 setQuota 引入仅限 loopback 的 `account.admin.*` 特权方法；本 PR 不包含这些方法。
- **没有密码重置流程**：不在范围内；如有需要，PR 2 的 10.1b 步骤可添加与钱包绑定的重置流程。
- **每个部署只有一个 SQLite 文件**：多租户部署需要每个租户一个文件；当前范围是单租户 xiaowei。
- **引导管理员只有一个账户**：它通过创建分享码启动传播树；其他账号仍使用普通的邀请注册流程。
- **旧版分享码明文不可恢复**：启用分享码加密存储前创建的记录保持掩码，所有者可以明确重新生成仍有效的分享码。schema 版本 3 打开现有生产数据前，部署必须先执行仓库要求的已授权离线迁移。
