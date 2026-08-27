# Integration specification

English | [中文](integration-spec.zh.md)

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

Name the external system, tenant or account scope, endpoint identity, and source of truth.

## Credentials

Record the credential provider, lifetime, required permissions, redaction rule, and failure behavior. Never place a secret in the specification.

## Operations

Every operation has an ID, `mode` (`read` or `write`), risk, approval, idempotency, retry, compensation, and audit policy. Describe inputs, outputs, timeout, and ownership below each operation.

## Requirements

### REQ-integration-example-001

State the integration obligation and its runtime boundary.

## Acceptance

### ACC-integration-example-001

State the end-to-end observable result and map this ID to repository-relative evidence when implemented.

## Decisions

Cite `docs/ops/scenario-integration-contract.md` and link the owning Agent Note.
