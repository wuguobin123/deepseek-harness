# Capability specification

[English](capability-spec.md) | 中文

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

命名服务、提供方、工具或 Skill，以及其消费者和生命周期负责人。

## Requirements

### REQ-capability-example-001

说明一个可观察行为、输入条件、失败规则或生命周期义务。

## Acceptance

### ACC-capability-example-001

说明组装后的行为及其确定性检查。状态为 `implemented` 时，将此 ID 映射到 `evidence` 下的仓库相对路径。

## Decisions

链接负责该能力的 Agent Note 以及相关包或子系统参考。
