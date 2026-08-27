---
name: dsh-sdd
description: Use when proposing, implementing, reviewing, or accepting a non-trivial DeepSeek Harness feature, reusable capability, or business-system integration through specification-driven development, including requirements, acceptance IDs, controlled operations, and evidence at the claimed runtime layer.
---

# Specification-driven development

Use this skill when a change needs a durable feature, capability, or integration specification.

1. Read [the SDD reference](../../../docs/sdd/README.md) and select the smallest applicable template: [feature](../../../docs/sdd/templates/feature-spec.md), [capability](../../../docs/sdd/templates/capability-spec.md), or [integration](../../../docs/sdd/templates/integration-spec.md).
2. Normalize the request before implementation: assign a globally unique document ID, non-empty owners, unique requirement and acceptance IDs, and integration controls where applicable. Keep the status `draft` until scope and observable outcomes are reviewable, then use `approved` as the implementation input.
3. State the expected effect and its evidence layer for every acceptance ID. A local test, assembled runtime test, runnable smoke, client observation, and production observation prove different claims; do not substitute a lower layer for the claimed result.
4. For an integration, declare every operation's mode, risk, approval, idempotency, retry, compensation, and audit policy. Reads are R1 with no approval; writes are R2 or R3 with per-call approval. Label simulated-provider evidence separately from a smoke against the real external system.
5. Implement against the approved specification. Run the narrow acceptance check while the behavior is absent or broken when practical, then rerun it after implementation so the evidence demonstrates the intended effect instead of only parsing the document.
6. If an acceptance check fails, keep the specification below `implemented`, diagnose the mismatch, and update the implementation or the approved requirement explicitly. Never delete or weaken evidence merely to pass `verify-sdd`.
7. Before completion, map every acceptance ID to repository-relative evidence, set `status: implemented`, and run `pnpm run verify-sdd`, scoped translation pairing, Agent Note format checks when a note changed, and the behavior checks named by the specification.

SDD records what must be true. [Ops scenario integration contract](../../../docs/ops/scenario-integration-contract.md) owns Skill/Subagent runtime rules, and [Agent Notes](../../notes/README.md) own durable rationale and alternatives; link to those records instead of duplicating them.
