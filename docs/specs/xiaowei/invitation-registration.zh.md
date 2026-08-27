---
sdd:
  id: feature.xiaowei.invitation-registration
  kind: feature
  status: implemented
  owners:
    - xiaowei-platform
  requirements:
    - id: REQ-xiaowei-invitation-registration-001
      text: Xiaowei creates an account only when the request supplies a valid single-use invitation code and the account population remains below the configured limit of 100 users.
    - id: REQ-xiaowei-invitation-registration-002
      text: Every registered user may issue at most three invitation codes, each code can register at most one account, and a newly invited account receives its own three-code allowance.
    - id: REQ-xiaowei-invitation-registration-003
      text: Invitation redemption, account creation, and the final population-limit check commit in one identity-database transaction so concurrent requests cannot reuse a code or exceed the limit.
    - id: REQ-xiaowei-invitation-registration-004
      text: The service encrypts invitation plaintext at rest, never logs it, and returns a full code only for an active unconsumed invitation owned by the authenticated account; consumed and expired invitations expose masked metadata only.
    - id: REQ-xiaowei-invitation-registration-005
      text: Signup email verification is bound to the signup purpose, normalized email, and invitation so a code cannot authorize another email, purpose, or invitation.
    - id: REQ-xiaowei-invitation-registration-006
      text: An owner may explicitly regenerate an active legacy invitation whose plaintext is unavailable, invalidating the old code without consuming another lifetime invitation slot.
  acceptance:
    - id: ACC-xiaowei-invitation-registration-001
      text: Signup rejects a missing, unknown, expired, consumed, or foreign-bound invitation without creating an account, while one valid invitation creates exactly one account.
      evidence:
        - packages/account/identity/tests/invitation.spec.ts
        - packages/host/apiproxy/tests/api-proxy-invitations.spec.ts
    - id: ACC-xiaowei-invitation-registration-002
      text: One account can create three invitations and the fourth request is rejected; each invited account can create its own invitations after signup.
      evidence:
        - packages/account/identity/tests/invitation.spec.ts
        - packages/host/apiproxy/tests/api-proxy-invitations.spec.ts
    - id: ACC-xiaowei-invitation-registration-003
      text: Concurrent signup attempts for one invitation yield one account, and concurrent attempts for the final slot yield exactly the configured population limit, which is 100 in Xiaowei.
      evidence:
        - packages/account/identity/tests/invitation.spec.ts
    - id: ACC-xiaowei-invitation-registration-004
      text: Invitation lists expose the full code for the owner's active unconsumed invitations, expose no plaintext for consumed or expired invitations, database inspection finds no plaintext code, and one account cannot inspect another account's invitation records.
      evidence:
        - packages/account/identity/src/index.ts
        - packages/account/identity/tests/invitation.spec.ts
        - packages/host/apiproxy/tests/api-proxy-invitations.spec.ts
        - packages/client/connection/tests/node-half.host.spec.ts
    - id: ACC-xiaowei-invitation-registration-005
      text: The assembled Xiaowei account view keeps active invitation codes visible and copyable, offers explicit regeneration for legacy masked codes, and keeps consumed or expired codes masked.
      evidence:
        - packages/account/email-verification/tests/email-verification.spec.ts
        - packages/host/apiproxy/tests/api-proxy-invitations.spec.ts
        - apps/desktop/tests/contracts.test.ts
        - apps/desktop/tests/signin-card.test.tsx
        - apps/desktop/tests/account-invites.test.tsx
  evidence:
    - packages/bundle/xiaowei/cordis.patch.yml
    - packages/account/identity/src/index.ts
    - packages/account/email-verification/src/index.ts
    - packages/host/apiproxy/src/api-proxy.ts
    - apps/desktop/src/renderer/features/auth/SignInCard.tsx
    - apps/desktop/src/renderer/features/account/AccountSection.tsx
  decisions:
    - .agents/notes/implemented/architecture/2026-08-26-invitation-registration.md
---
# 小薇邀请注册

[English](invitation-registration.md) | 中文

## 目标

小薇将验证阶段的注册账号限制为 100 个。注册必须使用已有账号生成的一次性分享码。每个账号可以邀请三个人，形成按所有者隔离的邀请关系；分享码不作为重复登录凭证。

## 注册规则

身份数据库中的每个账号都计入配置的人数上限，包括引导账号和现有账号。达到上限后停止生成分享码；注册在消耗分享码和插入账号的同一事务中再次检查上限。最后一个名额被占用后，已经生成但尚未使用的分享码仍可见，但不能再创建账号。

每个账号拥有三个终身分享码名额。生成分享码即消耗一个名额，即使该分享码以后未使用便过期也不返还。每个分享码只能使用一次，并在配置的期限后过期。被邀请账号可以正常使用密码登录，并获得自己的三个分享码名额。

## 安全规则

服务生成高熵分享码，持久化用于兑换校验的带密钥摘要，并使用带认证的加密算法单独加密保存明文。经过认证的所有者可以查看有效且未使用的完整分享码，以便在使用或过期前持续复制。已使用和已过期的分享码仅返回掩码元数据。服务绝不记录分享码明文，其他账号也不能查看或重新生成不属于自己的分享码。分享码检查不会区分未知、过期或已使用状态；生成分享码和最终注册事务会明确报告验证阶段名额已满。

启用加密存储前创建的分享码没有可恢复的明文。账号界面会将这些有效分享码标记为旧版，并要求用户明确执行“重新生成”。重新生成会替换同一条邀请记录中的分享码、使旧值失效，且不会再消耗一个终身分享码名额。

注册邮箱验证码同时绑定注册用途、分享码标识和规范化邮箱。邮箱验证码在创建身份前消费；如果之后身份创建失败，用户可能需要重新获取邮箱验证码，但分享码不会被消费。

## 证据边界

包级测试证明数据库事务、所有权、配额和脱敏。RPC 与桌面测试证明公开请求字段和产品流程。源码或组装运行态结果不能证明生产迁移、SMTP 实际投递或已安装客户端发布。
