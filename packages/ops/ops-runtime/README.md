# @deepseek-ai/dsh-ops-runtime

English | [中文](README.zh.md)

Phase 1 skeleton for the ops product's agent preset container. Specific orchestrators (route_work, capability_runner, evidence_validator, OPDCA planner, etc.) land here as separate subagent providers **only when a business scenario requires them**.

This package is intentionally a no-op today. It reserves the runtime surface so consumers can reason about "where an ops business Subagent comes from" before the first orchestrator ships.

## Plugin

Function plugin with no `inject` and no runtime state.

## When to land content here

A scenario enters this package when it needs its own multi-turn loop, dedicated tool set, or persona. The decision boundary is documented in the [scenario integration contract](../../../../docs/ops/scenario-integration-contract.md):

- **Use Skill** if the work is one prompt-shaped directive the parent model should read inline. The Skill ships under [`@deepseek-ai/dsh-ops-skill`](../ops-skill/README.md), not here.
- **Use Subagent** if the work needs its own session, tools, persona, or recursion budget. The Subagent ships as one provider + one agent preset mounted beside [`@deepseek-ai/dsh-ops-subagent-python`](../ops-subagent-python/README.md).

## OPDCA explicitly deferred

Per the [OPDCA deferral decision](../../../../docs/ops/decisions/0001-agent-handoff-event-deferred.md) context, OPDCA orchestrators (`route_work`, `capability_runner`, `evidence_validator`) do **not** ship with the plan. They land when a scenario explicitly requires them.

## Config

Empty. Config lands with the first orchestrator scenario.

## Model Experience

None. The plugin registers no service and emits no event; mounting it does not change the model's request prefix.

## Known Limitations and Deferred Work

- **Skeleton only** — no agent preset is registered today.
- **No OPDCA migration** — OPDCA and related orchestrators are not in this plan.
