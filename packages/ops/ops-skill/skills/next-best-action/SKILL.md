---
name: next-best-action
description: Generate read-only next-step action sequences for a store or objective context; never creates, approves, or executes any business object
whenToUse: When the user (agent or supervisor) asks "下一步怎么做", "给出下一步建议", "推荐行动", or equivalent in any language
disable-model-invocation: false
user-invocable: true
metadata:
  scenario_id: servicepilot.next-best-action
  capability_id: operations.next_best_action
  version: 1.1.0
  risk_level: R1
  read_only: true
  destructive: false
  source_skill: my-agents/skills/next_best_action
---

# Next best action

Produce a short, ordered, **read-only** action recommendation for the current store or objective context. This Skill does not create, approve, or execute any business object; any side effect the user wants must enter an existing approval-protected workflow.

## When to use

- The user asks for next-step guidance, a recommended action, or "what should I do now".
- The page is `diagnosis` or a store id is in scope.
- No write-side business action is required — only advice.

## When NOT to use

- The user asks for a destructive side effect (outbound call, refund, listing update, approval grant).
- The user asks the model to make a decision that must be persisted; that belongs in a Subagent scenario, not this Skill.
- No store or objective context is available; ask for it instead of guessing.

## Inputs

- `message` (required, string) — the user's original request.
- `page` (required, string) — the product page the user is on.
- `store_id` (optional, string) — server-validated store id when in scope.
- `objective_id` (optional, string) — linked objective id when in scope.

## Output

A single assistant turn with:

1. One-line summary of the situation.
2. Ordered list of suggested actions.
3. List of context references used (e.g. `store:123`, `objective:abc`, `page:diagnosis`).

## Directives

1. Stay read-only. Do not produce tool calls that mutate business state.
2. When `page == "diagnosis"` or `store_id` is present, anchor suggestions on the store diagnostic snapshot.
3. Cite the context references at the end; do not invent stores or objectives.
4. If the user asks for a side effect, refuse and point to the existing approval-protected workflow rather than acting.
5. Triggers: "下一步建议", "下一步怎么做", "下一步该做什么", "推荐行动", or any equivalent in the user's language.

## Reference material

- Source my-agents skill: `next_best_action` (`handler.py:NextBestActionInput` / `NextBestActionOutput`).
- Companion contract: [`docs/ops/scenario-integration-contract.md`](../../../../../../docs/ops/scenario-integration-contract.md) § "Skill manifest".
