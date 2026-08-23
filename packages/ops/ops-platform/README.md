# @deepseek-ai/dsh-ops-platform

English | [中文](README.zh.md)

Capability Registry + risk taxonomy for the ops product group. The plugin will eventually expose `ctx.opsPlatform` so the harness and the ops Subagents can enumerate registered capabilities (Skill, MCP, Subagent), validate that a requested execution matches a granted approval (`risk_level` + `execution_version` + `arguments_hash`), and resolve the planner hints (`after`, `requires`, `step_id`) that downstream orchestrators consume.

The risk taxonomy distinguishes three levels: `R1` (read-only, low blast radius), `R2` (side effects are reversible within the agent scope), and `R3` (irreversible or out-of-scope effects that require an explicit approval). The taxonomy is reserved here and lands together with the first capability manifest.

Today the plugin is a Phase 1 skeleton that only reserves the `ctx.opsPlatform` surface and the companion invariant registration. The schema and risk taxonomy land when the first scenario declares a capability manifest.

## Plugin

Function plugin with `inject: ['subagents']` and no runtime state. Mount it through a `cordis.patch.yml` row when the first scenario that needs the capability registry is接入ed.

## Config

Empty. Config lands with the first capability manifest.

## Model Experience

None. The plugin registers no service and emits no event today; mounting it does not change the model's request prefix.

## Known Limitations and Deferred Work

- **Skeleton only** — no risk taxonomy is registered; first capability lands with its scenario. `ctx.opsPlatform` is reserved but not registered.
