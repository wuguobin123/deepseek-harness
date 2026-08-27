---
sdd:
  id: capability.ops.next-best-action
  kind: capability
  status: implemented
  owners:
    - ops-platform
  requirements:
    - id: REQ-ops-next-best-action-001
      text: The Skill produces read-only, ordered next-step advice for a supplied store or objective context.
    - id: REQ-ops-next-best-action-002
      text: The Skill refuses side effects and directs write requests to an approval-protected workflow.
  acceptance:
    - id: ACC-ops-next-best-action-001
      text: The bundled Skill has the declared manifest, read-only risk metadata, and required output directives.
      evidence:
        - docs/ops/templates/verify.py
        - packages/ops/ops-skill/tests/loader-composition.spec.ts
    - id: ACC-ops-next-best-action-002
      text: The assembled Skill loader discovers and disposes next-best-action without a model call or network access.
      evidence:
        - docs/ops/templates/verify.py
        - packages/ops/ops-skill/tests/loader-composition.spec.ts
  evidence:
    - docs/ops/templates/verify.py
    - packages/ops/ops-skill/tests/loader-composition.spec.ts
  decisions:
    - docs/ops/scenario-integration-contract.md
    - .agents/notes/implemented/process/2026-08-26-specification-driven-development.md
---
# Next-best-action capability

[English](next-best-action.md) | 中文

该能力是 ops Skill 路径的 SDD 试点。它使用当前门店或目标上下文，为用户或主管提供简短、有序、只读的行动建议。

## Runtime contract

该 Skill 可由用户和模型调用，风险级别为 R1，绝不创建、审批或执行业务对象。对于副作用请求，它会转交既有的受审批保护工作流。

输入需要 `message` 和 `page`；`store_id` 和 `objective_id` 是可选的、由服务器验证的上下文标识符。输出包含一行情况摘要、有序行动列表和所使用的上下文引用。

## Verification

无密钥模板验证器检查内置 manifest 和 Skill 正文。组装后的 loader 测试检查发现、加载和释放。每项验收都列出两个路径，使 implemented 声明持续绑定到具体检查。
