# Capability specification

English | [中文](capability-spec.zh.md)

```yaml
sdd:
  id: capability.example
  kind: capability
  status: draft
  owners:
    - team/example
  requirements:
    - id: REQ-capability-example-001
      text: State one observable capability obligation.
  acceptance:
    - id: ACC-capability-example-001
      text: State one observable acceptance result.
      evidence: []
  evidence: []
  decisions: []
```

## Capability

Name the service, provider, tool, or Skill, its consumers, and its lifecycle owner.

## Requirements

### REQ-capability-example-001

State one observable behavior, input condition, failure rule, or lifecycle obligation.

## Acceptance

### ACC-capability-example-001

State the assembled behavior and its deterministic check. When status is `implemented`, map this ID to a repository-relative path under `evidence`.

## Decisions

Link the owning Agent Note and relevant package or subsystem reference.
