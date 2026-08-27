# Subagent Scenario Template

English | [中文](README.zh.md)

Copy this directory next to your profile's `cordis.yml`, rename `hello_subagent.py` to your scenario's snake_case name, and update `cordis.patch.yml` to match. The Python peer speaks JSON-RPC 2.0 over stdio through `@deepseek-ai/dsh-ops-subagent-python`; the patch overlay mounts both the provider row and a one-shot caller that drives an `agent.turn` to verify the wire.

## Files

- `hello_subagent.py` — the Python peer. Handles `initialize` and `agent.turn`; emits `session.event` notifications when the scenario produces observable state.
- `cordis.patch.yml` — patch overlay that mounts `dsh-ops-subagent-python` plus a thin caller preset used for the smoke check.

## Naming

`hello_subagent.py` is a placeholder. Rename the file to your scenario's snake_case name, change the `module:` value in `cordis.patch.yml` to match (`scenario_name.peer_main` for `-m scenario_name.peer_main` invocation), and rename the preset id from `ops-hello-subagent` to `ops-<scenario>`.

## Wire protocol

The Python peer reads newline-delimited JSON-RPC 2.0 messages from stdin and writes responses/notifications to stdout. The provider documents the full schema in [`@deepseek-ai/dsh-ops-subagent-python`](../../../../packages/ops/ops-subagent-python/README.md). The template implements only the two methods the provider calls during a normal lifecycle:

| Method | Direction | When |
|---|---|---|
| `initialize` | request | once, after spawn, before any `agent.turn` |
| `agent.turn` | request | once per `ctx.subagents.start(...)` call |

The peer may emit `session.event` notifications at any point; the provider forwards them into the parent session log.

## Mounting

```sh
PYTHONPATH=docs/ops/templates/subagent \
  pnpm dsh --profile headless --patch docs/ops/templates/subagent/cordis.patch.yml "..."
```

`PYTHONPATH` makes the renamed module importable as `-m scenario_name.peer_main`. The provider spawns `python3 -m scenario_name.peer_main` and runs the JSON-RPC handshake.

## Verifying

Boot the patched profile and run the included caller preset. The provider spawns the Python peer, completes the handshake, sends one `agent.turn`, and returns the stub response. A successful run produces a single assistant message in the parent's session log starting with `[hello-subagent stub]`.

## Boundaries

A Subagent owns one session per `start` and one final assistant text per turn. It does not persist cross-session state unless the scenario ships its own store. The provider forwards `session.event` notifications but does not bridge the child's transcript into the parent log; the parent only sees the final result.

For scenarios that ship prompt content only and do not need their own session, use the [Skill template](../skill/README.md) instead.

See the [Scenario Integration Contract](../../scenario-integration-contract.md) for the boundary rules between Skill and Subagent, the manifest fields, and the lifecycle obligations.
