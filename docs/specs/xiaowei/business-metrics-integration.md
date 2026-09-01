---
sdd:
  id: integration.xiaowei.business-metrics
  kind: integration
  status: implemented
  owners:
    - xiaowei-platform
  requirements:
    - id: REQ-xiaowei-business-metrics-001
      text: An authorized account can ask for the current registered-account count through a read-only configured operation without exposing account records.
    - id: REQ-xiaowei-business-metrics-002
      text: An authorized account can ask for the number of its consumed invitation codes, with the owner derived from trusted execution context rather than operation input.
    - id: REQ-xiaowei-business-metrics-003
      text: Both operations return bounded count-only results with observation time and record a secret-free audit outcome.
  acceptance:
    - id: ACC-xiaowei-business-metrics-001
      text: A keyless configured-provider check answers the two Chinese questions with exact structured counts and rejects a caller lacking the operation permission.
      evidence:
        - packages/business/connector-http/tests/connector-http.spec.ts
        - packages/business/runtime/tests/runtime.spec.ts
        - packages/business/gateway/tests/gateway.spec.ts
    - id: ACC-xiaowei-business-metrics-002
      text: A real Xiaowei business endpoint smoke verifies authentication, owner scoping, response validation, and audit correlation separately from the simulated-provider evidence.
      evidence:
        - docs/ops/xiaowei-business-metrics-acceptance.md
  evidence:
    - packages/business/connector-http/src/index.ts
    - packages/business/gateway/src/index.ts
    - packages/business/runtime/src/index.ts
    - docs/ops/xiaowei-business-metrics-acceptance.md
  decisions:
    - docs/specs/xiaowei/business-skill-hot-loading.md
    - .agents/notes/implemented/architecture/2026-09-01-declarative-business-skill-runtime.md
  identity:
    tenant_scope: authenticated account owner; tenant selection is unsupported until an authoritative membership service exists
  credentials:
    provider: deployment-owned credential reference resolved per operation
  operations:
    - id: operation.xiaowei.registered-accounts.read
      mode: read
      risk: R1
      approval: none
      idempotency: safe
      retry: bounded
      compensation: none
      audit: required
    - id: operation.xiaowei.share-code-usage.read
      mode: read
      risk: R1
      approval: none
      idempotency: safe
      retry: bounded
      compensation: none
      audit: required
---
# Xiaowei business metrics integration

English | [中文](business-metrics-integration.zh.md)

This integration is the first configured consumer of the business Skill runtime. It exposes two read-only count operations: the platform registered-account count for a permitted operator and consumed invitation-code count scoped to the authenticated owner.

## Identity

The Host validates the account bearer before admitting the prompt. The business executor derives the owner from the Session header and never accepts an account or tenant selector in operation input.

## Credentials

The connector resolves a deployment-owned credential reference immediately before the request. The definition, model, client response, tool arguments, and audit record contain no credential value.

## Operations

Both operations are R1 reads with bounded retry, no approval, no compensation, strict output validation, and required audit. The registered-account operation requires platform metrics permission; the invitation operation additionally restricts the resource owner to the authenticated account.

## Verification

Focused checks prove routing, authorization, retry limits, response validation, and durable secret-free audit without external access. The [production acceptance](../../ops/xiaowei-business-metrics-acceptance.md) separately records the internal TLS endpoint probes, hot publication, and installed-client questions.
