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

English | [中文](next-best-action.zh.md)

This capability is the SDD pilot for the ops Skill path. It gives a user or supervisor a short, ordered, read-only recommendation using the current store or objective context.

## Runtime contract

The Skill is user-invocable and model-invocable, carries risk level R1, and never creates, approves, or executes a business object. Requests for a side effect are redirected to an existing approval-protected workflow.

The input requires `message` and `page`; `store_id` and `objective_id` are optional server-validated context identifiers. The output contains a one-line situation summary, an ordered action list, and the context references used.

## Verification

The keyless template verifier checks the bundled manifest and Skill body. The assembled loader test checks discovery, loading, and disposal. Each acceptance item names both paths so the implemented claim remains tied to the exact checks.
