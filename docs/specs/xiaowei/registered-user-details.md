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
# Xiaowei registered-user details

English | [中文](registered-user-details.zh.md)

## Identity

Xiaowei derives the requester from the authenticated Session. The Connector supplies that identity outside model arguments, and the Gateway checks the subject-hashed `users.details.read` grant. The operation accepts no identity or tenant selector.

## Credentials

The existing deployment-owned service bearer authenticates the Connector to the loopback Gateway through internal TLS. Missing or invalid credentials fail before any user detail query, and no credential enters configuration, output, or audit.

## Operation

`registered-user-details` accepts an optional positive integer `page`, defaults to page one, and uses a fixed page size of ten. Items contain only `maskedEmail` and `registeredDate`; registration date has day precision. The result includes `page`, `pageSize`, `hasMore`, and `observedAt`, and remains below 4096 bytes.

## Deployment

The registered action requires one independent Gateway deployment and restart. Configuration revision 3 then enables the action and grant through atomic hot loading, and Skill revision 4 exposes it through the existing Connector. Xiaowei remains running throughout both changes.
