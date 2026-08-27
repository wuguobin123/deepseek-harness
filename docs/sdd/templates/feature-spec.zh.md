# Feature specification

[English](feature-spec.md) | 中文

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

说明用户或操作员结果以及平台职责层级。

## Requirements

### REQ-feature-example-001

说明一个可观察、可测试的义务。除非决策已记录在 `decisions` 中，否则不要写入实现选择。

## Acceptance

### ACC-feature-example-001

说明可观察结果、参与者和能够证明它的检查。状态为 `implemented` 时，在 `evidence` 下添加一个或多个仓库相对路径。

## Decisions

链接 Agent Note 或其他仓库决策记录中的持久理由。
