---
sdd:
  id: integration.xiaowei.registered-user-details
  kind: integration
  status: implemented
  owners:
    - xiaowei-platform
  requirements:
    - id: REQ-xiaowei-registered-user-details-001
      text: The account-private business Skill exposes a paginated registered-user detail operation through the independent Business Gateway without changing or restarting the Xiaowei Host.
    - id: REQ-xiaowei-registered-user-details-002
      text: Each item contains only maskedEmail and day-precision registeredDate; the response excludes raw user ids, full email addresses, display names, exact timestamps, password material, Sessions, invitations, credentials, and tenant identity.
    - id: REQ-xiaowei-registered-user-details-003
      text: The operation requires the independent users.details.read grant on every call and never inherits access from aggregate metric permissions.
    - id: REQ-xiaowei-registered-user-details-004
      text: Only an optional positive page scalar is accepted, page size is fixed at ten, output is bounded to 4096 bytes, and unknown, repeated, identity, tenant, body, or out-of-range input fails closed.
    - id: REQ-xiaowei-registered-user-details-005
      text: Gateway audit records the authenticated requester subject hash, operation, outcome, and time without recording returned user details, raw requester identity, or credentials.
  acceptance:
    - id: ACC-xiaowei-registered-user-details-001
      text: Focused real HTTP and SQLite tests prove deterministic pagination, terminal pages, minimal disclosure, independent permission enforcement, invalid-input rejection, bounded output, and secret-free audit while preserving the existing three operations.
      evidence:
        - packages/business/gateway/tests/gateway.spec.ts
    - id: ACC-xiaowei-registered-user-details-002
      text: Production upgrades and restarts only dsh-business-gateway.service, then hot-loads Gateway configuration revision 3 and business Skill revision 4 while the Xiaowei PID and start time remain unchanged.
      evidence:
        - docs/ops/xiaowei-registered-user-details-acceptance.md
    - id: ACC-xiaowei-registered-user-details-003
      text: An authenticated installed Xiaowei client invokes registered-user-details through business_skill_call, receives a bounded first page, and produces the matching successful Gateway audit event without exposing forbidden fields.
      evidence:
        - docs/ops/xiaowei-registered-user-details-acceptance.md
        - packages/business/gateway/deploy/installed-client-user-details-qa.mjs
  evidence:
    - packages/business/gateway/src/index.ts
    - packages/business/gateway/deploy/seed-config.mjs
    - packages/business/gateway/deploy/publish-skill-v4.mjs
    - docs/ops/xiaowei-registered-user-details-acceptance.md
  decisions:
    - .agents/notes/implemented/feature/2026-09-01-masked-registered-user-details.md
    - .agents/notes/implemented/architecture/2026-09-01-independent-business-gateway.md
  identity:
    tenant_scope: authenticated account owner with an explicit subject-hashed Gateway grant; tenant selection remains unsupported
  credentials:
    provider: deployment-owned service bearer resolved by Xiaowei; neither login token nor credential value enters Skill or Gateway configuration
  operations:
    - id: operation.xiaowei.registered-user-details.read
      mode: read
      risk: R1
      approval: none
      idempotency: safe
      retry: bounded
      compensation: none
      audit: required
---
# 小薇注册用户明细

[English](registered-user-details.md) | 中文

## 身份

小薇从认证 Session 派生请求者。Connector 在模型参数之外提供该身份，Gateway 检查使用 subject hash 的 `users.details.read` 授权。操作不接受身份或租户选择字段。

## 凭据

既有部署服务 Bearer 通过内部 TLS 认证 Connector 到回环 Gateway。凭据缺失或无效时，在查询任何用户明细前失败；配置、输出或审计都不包含凭据。

## 操作

`registered-user-details` 接受可选的正整数 `page`，默认为第一页，每页固定十条。每项只包含 `maskedEmail` 和 `registeredDate`，注册日期精度为天。结果包含 `page`、`pageSize`、`hasMore` 和 `observedAt`，并保持在 4096 字节以内。

## 部署

注册该 action 需要部署并重启一次独立 Gateway。随后配置 revision 3 通过原子热加载启用 action 与授权，Skill revision 4 通过既有 Connector 暴露该操作；整个过程保持小薇运行。
