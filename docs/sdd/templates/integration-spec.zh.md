# Integration specification

[English](integration-spec.md) | 中文

```yaml
sdd:
  id: integration.example
  kind: integration
  status: draft
  owners:
    - team/example
  requirements:
    - id: REQ-integration-example-001
      text: State one observable integration obligation.
  acceptance:
    - id: ACC-integration-example-001
      text: State one observable acceptance result.
      evidence: []
  evidence: []
  decisions: []
  identity:
    tenant_scope: required
  credentials:
    provider: required
  operations:
    - id: operation.example.read
      mode: read
      risk: R1
      approval: none
      idempotency: safe
      retry: bounded
      compensation: none
      audit: required
    - id: operation.example.write
      mode: write
      risk: R2
      approval: per-call
      idempotency: required
      retry: bounded
      compensation: required
      audit: required
```

## Identity

命名外部系统、租户或账号范围、端点身份及其事实来源。

## Credentials

记录凭据提供方、有效期、所需权限、脱敏规则和失败行为。规格中绝不放置秘密。

## Operations

每个操作包含 ID、`mode`（`read` 或 `write`）、风险、审批、幂等性、重试、补偿和审计策略。在每个操作下说明输入、输出、超时和负责人。

## Requirements

### REQ-integration-example-001

说明集成义务及其运行时边界。

## Acceptance

### ACC-integration-example-001

说明端到端可观察结果；实现时将此 ID 映射到仓库相对证据路径。

## Decisions

引用 `docs/ops/scenario-integration-contract.md`，并链接负责该决策的 Agent Note。
