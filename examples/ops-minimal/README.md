# ops-minimal

English | [中文](README.zh.md)

Phase 0 zero-milestone demo. Mounts the `ops-subagent-python` provider, points it at a stub Python entry script (`ops_minimal.subagent_main`), and lets the parent harness drive one `agent.turn` through the JSON-RPC wire.

The Python stub is at [`./ops_minimal/subagent_main.py`](./ops_minimal/subagent_main.py) and contains the full `initialize` / `agent.turn` / `session.event` lifecycle documented in the package README.

## What this proves

- The provider spawns `python3 -m ops_minimal.subagent_main` and survives the JSON-RPC handshake
- `session.event` notifications travel Python -> TS and land in the parent session log
- One `agent.turn` request returns one `agent.turn.result` response and the child disposes cleanly

## How to run

```sh
PYTHONPATH=examples/ops-minimal \
  pnpm dsh --config examples/ops-minimal/cordis.yml --profile headless "hello, ops"
```

The expected output is a single assistant message from the Python stub starting with `[ops-python stub]`.

## What this does NOT prove (Phase 1+)

- A real LLM call (the stub bypasses `ctx.llm`)
- The full my-agents ops-domain, ops-skill catalogue, OPDOR orchestrator
- Multi-agent handoff via `agent/handoff` session events
- Approval, loop detection, outbox

Those are the goals of Phase 1-6 and are tracked separately.
