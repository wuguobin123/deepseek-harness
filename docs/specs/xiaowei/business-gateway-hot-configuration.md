---
sdd:
  id: integration.xiaowei.business-gateway-hot-configuration
  kind: integration
  status: implemented
  owners:
    - xiaowei-platform
  requirements:
    - id: REQ-xiaowei-business-gateway-hot-configuration-001
      text: Xiaowei dispatches account business Skill operations through one stable HTTPS Connector while an independently managed Gateway owns business authorization and data access, so publishing an ordinary supported read operation never replaces or restarts the Xiaowei Host process.
    - id: REQ-xiaowei-business-gateway-hot-configuration-002
      text: Gateway configuration selects only registered providers and actions, explicit metric paths and permissions, and hashed grants; the separately validated Skill manifest owns model-facing schemas, and neither configuration can contain executable code, SQL, arbitrary headers, credential values, userId, or tenantId.
    - id: REQ-xiaowei-business-gateway-hot-configuration-003
      text: The Gateway authenticates the deployment-owned service bearer, rejects tenant identity, validates the Host-derived user against the identity source, and checks a dynamically loaded user grant before every query.
    - id: REQ-xiaowei-business-gateway-hot-configuration-004
      text: A complete valid configuration atomically replaces the active immutable snapshot and becomes visible to the next request without restarting either service, while invalid configuration retains the last-good snapshot.
    - id: REQ-xiaowei-business-gateway-hot-configuration-005
      text: Every permitted or denied call records a bounded secret-free durable audit entry, and audit failure prevents a business result from being returned.
    - id: REQ-xiaowei-business-gateway-hot-configuration-006
      text: Production cutover and rollback change only the internal nginx upstream and preserve Xiaowei account, Session, Skill, Gateway configuration, and audit data.
  acceptance:
    - id: ACC-xiaowei-business-gateway-hot-configuration-001
      text: Focused checks reject unregistered providers and actions, unsupported or reserved configuration fields, unsafe owner scope, duplicate paths, database paths outside the startup root, bad credentials, tenant headers, unknown users, permission mismatch, ungranted users, request input, and unavailable audit storage.
      evidence:
        - packages/business/gateway/tests/gateway.spec.ts
    - id: ACC-xiaowei-business-gateway-hot-configuration-002
      text: An assembled Gateway serves the two existing metrics, hot-loads a third configured owner-scoped metric and its grant without process replacement, and retains the previous operations after an invalid update.
      evidence:
        - packages/business/gateway/tests/gateway.spec.ts
        - docs/ops/xiaowei-business-gateway-acceptance.md
    - id: ACC-xiaowei-business-gateway-hot-configuration-003
      text: Production probes and an installed Xiaowei client use the independent Gateway before and after a hot Skill revision, while the recorded Xiaowei PID and service start time remain unchanged across deployment and nginx reload.
      evidence:
        - docs/ops/xiaowei-business-gateway-acceptance.md
        - packages/business/gateway/deploy/installed-client-qa.mjs
  evidence:
    - packages/business/gateway/src/index.ts
    - packages/business/gateway/tests/gateway.spec.ts
    - packages/business/gateway/deploy/dsh-business-gateway.service
    - docs/ops/xiaowei-business-gateway-acceptance.md
  decisions:
    - .agents/notes/implemented/architecture/2026-09-01-independent-business-gateway.md
    - .agents/notes/implemented/architecture/2026-09-01-declarative-business-skill-runtime.md
  identity:
    tenant_scope: authenticated account owner; tenant selection remains unsupported
  credentials:
    provider: deployment-owned service bearer resolved by Xiaowei and supplied to the loopback-only Gateway through internal TLS
  operations:
    - id: operation.xiaowei.business-metric.read
      mode: read
      risk: R1
      approval: none
      idempotency: safe
      retry: bounded
      compensation: none
      audit: required
---
# Xiaowei Business Gateway hot configuration

English | [中文](business-gateway-hot-configuration.zh.md)

The independent Gateway is the execution and authorization service for account business Skills. Xiaowei retains one stable model-facing dispatcher and HTTPS Connector; configuration below the Gateway selects only reviewed read providers and logical actions.

## Identity and credentials

The Xiaowei Host derives the account from its authenticated Session and sends that identity only in a trusted Connector header. The Gateway accepts no identity selector in request input or configuration, rejects every tenant header, and never receives the Xiaowei login token. A deployment-owned service bearer authenticates the connection separately from the user grant.

## Hot configuration

Gateway configuration is parsed and validated as one snapshot before publication. Each request pins one snapshot. A valid atomic file replacement affects the next request; an invalid replacement leaves the last-good snapshot active. The initial provider exposes only reviewed aggregate actions over logical Xiaowei identity resources, so configuration cannot become a generic SQL or network execution channel.

## Production lifecycle

The Gateway listens only on loopback, while nginx terminates TLS for the already approved `business.xiaowei.internal` connection. Cutover and rollback replace the nginx upstream and reload nginx. Neither action changes the Xiaowei process or its active Sessions.

## Verification

Deterministic checks cover configuration, authentication, authorization, query binding, hot replacement, last-good retention, output limits, and fail-closed audit. Production acceptance separately proves the independent process, nginx cutover, existing metrics, a newly configured metric, Skill revision publication, installed-client question, and unchanged Xiaowei PID and start time.
