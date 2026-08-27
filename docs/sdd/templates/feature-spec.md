# Feature specification

English | [中文](feature-spec.zh.md)

```yaml
sdd:
  id: feature.example
  kind: feature
  status: draft
  owners:
    - team/example
  requirements:
    - id: REQ-feature-example-001
      text: State one observable feature obligation.
  acceptance:
    - id: ACC-feature-example-001
      text: State one observable acceptance result.
      evidence: []
  evidence: []
  decisions: []
```

## Outcome

State the user or operator outcome and the platform responsibility level.

## Requirements

### REQ-feature-example-001

State one observable, testable obligation. Keep implementation choices out unless they are a decision recorded in `decisions`.

## Acceptance

### ACC-feature-example-001

State the observable result, its actor, and the check that can prove it. When status is `implemented`, add one or more repository-relative paths under `evidence`.

## Decisions

Link durable rationale in an Agent Note or another repository decision record.
