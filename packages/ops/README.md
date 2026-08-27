# ops

English | [中文](README.zh.md)

`ops` is the **product group** that hosts "小薇办公助手" (ServicePilot) — the business layer on top of the dsh agent harness. It exists so the dsh core seams are not specialised for any single product; ops-* packages implement the enterprise workbench pieces that consume them.

Every package in this group **registers through a dsh seam** (`ctx.subagents`, `ctx.tools`, `ctx.sessionTitle`, `ctx.userApproval`, …) rather than patching the host runtime directly; the host-runtime policy, the loader smoke, and the persistence catalog still own whether they are visible to a given profile.

## Group contract

- **Use the dsh cordis vocabulary.** Every contribution goes through `ctx.effect()`, `ctx.on()`, or `ctx.waterfall()`. Plugin default-export shape is reserved for Service subclasses; function plugins named-export `name` / `inject` / `Config` / `apply`.
- **The Python business runtime is `ctx.subagents` peer.** `ops-subagent-python` registers a Python subagent provider; my-agents business logic (the ops-domain Pydantic business models and skill implementations) runs in its own process and exchanges JSON-RPC messages over stdio, sharing no Cordis context.
- **My-agents' lifecycle boundaries stay on the business side.** The session log is the source of truth for every model-visible fact (the "model-visible ⟺ logged" invariant), so the Python side writes ops-domain facts by sending `session.event` notifications; the TS harness projects, persists, and replays them.
- **No third native framework inside this group.** Python-side framework concerns (LangGraph state graphs, FastAPI, the OpenClaw plugin loader) live in `my-agents/` and are replaced by dsh seams, not by another in-process framework.

## Packages

| Package | Role |
|---|---|
| [`ops-subagent-python`](./ops-subagent-python/README.md) | The `ops-python` subagent provider; spawns a Python child that runs my-agents business logic and exchanges JSON-RPC over stdio |
| [`ops-skill`](./ops-skill/README.md) | Bundled Skill provider that scans `skills/<name>/SKILL.md` and exposes them on `ctx.skills` |
| [`ops-domain`](./ops-domain/README.md) | TypeScript mirror that reserves `ctx.opsDomain` for future TS-side consumers |
| [`ops-runtime`](./ops-runtime/README.md) | Agent preset container for business Subagents; specific orchestrators (route_work, capability_runner, evidence_validator, OPDCA, …) land here when a scenario requires them |
| [`ops-platform`](./ops-platform/README.md) (skeleton) | Capability Registry + risk taxonomy; the surface orchestrators consume for capability manifests and planner hints |
| [`ops-approval-policy`](./ops-approval-policy/README.md) (skeleton) | Approval extensions: `risk`, `executionVersion`, `validForSeconds`, `argumentsHash` bound to `ctx.userApproval` |
| [`ops-package-signing`](./ops-package-signing/README.md) (skeleton) | HMAC-SHA256 package signing for distributed Skill/Subagent bundles |
| [`ops-loop-guard`](./ops-loop-guard/README.md) (skeleton) | 5-class loop detection on top of `ctx.repeatToolReminder` |
| [`ops-workbench-conversations`](./ops-workbench-conversations/README.md) (skeleton) | Multi-turn conversation surface with tenant/actor isolation and SSE event projection; lands when a scenario needs multi-tenant chat history |
| [`ops-workbench-memories`](./ops-workbench-memories/README.md) (skeleton) | OpenViking memory adapter; auto-extracts memories from completed turns and persists as Markdown; lands when a scenario needs cross-session memory |
| [`ops-workbench-trigger`](./ops-workbench-trigger/README.md) (skeleton) | Cross-session triggers (cron + event listeners); session-local reminders borrow dsh `schedule/schedule` |
| [`ops-workbench-anomaly`](./ops-workbench-anomaly/README.md) (skeleton) | Anomaly detection service exposed through `ctx.anomalies`; detectors land with the first scenario that needs them |

## Adding a scenario

Scenarios are added one at a time through the [scenario integration contract](../../docs/ops/scenario-integration-contract.md). Skeleton templates are at [`docs/ops/templates/`](../../docs/ops/templates/):

- Skill接入 — copy [`templates/skill/`](../../docs/ops/templates/skill/README.md) into `ops-skill/skills/<name>/`.
- Subagent接入 — copy [`templates/subagent/`](../../docs/ops/templates/subagent/README.md) into a sibling package.

The OPDCA orchestrator and the related route_work / capability_runner / evidence_validator presets are **not** part of this plan; they land when a business scenario explicitly requires them.

## See also

- [Group conventions](../CLAUDE.md) — package invariants, export shape, `./invariant`
- [Architecture](../../docs/architecture.md) — capability seam vocabulary this group reuses
- [Cordis primer](../../docs/cordis-primer.md) — `ctx.effect/on/waterfall` semantics