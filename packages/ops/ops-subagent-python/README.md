# @deepseek-ai/dsh-ops-subagent-python

English | [中文](README.zh.md)

The Python subagent provider for the ops group. Each child is a fresh Python
interpreter process that runs the my-agents business logic (the ops-domain
Pydantic business models and skill implementations) and exchanges
newline-delimited JSON-RPC 2.0 messages with the parent harness over stdio.
The child shares no Cordis context with the parent.

This is the in-tree counterpart to [`dsh-subagent-dsh-sdk`](../../subagent/subagent-dsh-sdk/README.md):
that backend spawns a child TypeScript harness runtime; this one spawns a
Python interpreter, so the business runtime that holds the Pydantic domain
models can stay where it is most productive.

## Wire protocol

The wire is intentionally minimal for the Phase 0 zero-milestone:

| Direction | Method | Payload |
|---|---|---|
| TS -> Python | `initialize` | `{ agentId, sessionId }` — handshake so the Python side can resolve the ops-domain runtime |
| TS -> Python | `agent.turn` | `{ messages, tools, context }` — one model request |
| Python -> TS | `agent.turn.result` | `{ content, tool_calls, stop_reason, usage }` — one model response |
| Python -> TS (notification) | `session.event` | `{ type, data }` — append-only ops-domain fact to the parent session log |

The Python child reads/writes one JSON object per line on stdin/stdout; the
parent harness parses line-delimited JSON. JSON-RPC 2.0 framing is preserved
so future phases can add `tool.call` forwarding, `request.context` injection,
and `subagent.continuation` for child-to-parent messaging without changing
the wire shape.

## Start and ownership

`start(request)` resolves the child's working directory exactly like the
SDK and ACP backends (config override validated once at load, else the
delegating parent session's cwd — never the server process's own cwd),
spawns `python -m <config.module>` and the configured `args`, then performs
the `initialize` JSON-RPC handshake. Fulfillment happens before the run returns,
so a successful start means the Python child is ready.

The returned run id is minted in the parent namespace; the child's session
id exists only inside the Python process. After publication the provider
owns the subprocess and forwards any `session.event` notifications through
the parent session log so persistence, projection, and UI replay all
reflect ops-domain facts without re-implementing them.

`dispose()` closes stdin, waits for `disposeEofGraceMs`, then escalates
SIGTERM (with `disposeGraceMs` to SIGKILL).

## Capabilities and context

The provider advertises no start-time capabilities
(`outputSchema` / `depthLimit` / `toolFilter` / `persona` all false) and
`inheritsParentContext: false`: the child is a fresh interpreter in another
process and the only parent-derived input is the workspace cwd. Tool
routing is parent-side; the Python side sees tool definitions in the
`agent.turn` payload and decides how to use them.

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `providerName` | `ops-python` | Registry name on `ctx.subagents`. |
| `command` | `python3` | Interpreter to spawn per start. |
| `module` | required | Python module entry point (e.g. `ops_runtime.subagent_main`). |
| `args` | `[]` | Extra arguments forwarded to the module. |
| `cwd` | parent session cwd | Working-directory override; same validation as the SDK backend. |
| `env` | `{}` | Explicit child environment layered over a credential-scrubbed parent environment. |
| `turnTimeoutMs` | unbounded | Bound on each `agent.turn` request before the parent treats it as errored. |
| `disposeEofGraceMs` | `6000` | Grace after stdin EOF before platform termination. |
| `disposeGraceMs` | `3000` | SIGTERM-to-SIGKILL grace; POSIX waits this long after SIGTERM before SIGKILL. |

```yaml
- id: ops-subagent-python
  name: '@deepseek-ai/dsh-ops-subagent-python'
  config:
    providerName: ops-python
    command: python3
    module: ops_runtime.subagent_main
    args: ['--wire=stdio']
    env:
      APP_TENANT: !!env APP_TENANT
```

## See also

- [`dsh-subagent`](../subagent/README.md) — provider registry contract and out-of-process helpers
- [`dsh-subprocess`](../subprocess/subprocess/README.md) — `scrubbedParentEnv` for safe child env layering
- [`dsh-session`](../core/session/README.md) — `session.append` for forwarding ops-domain events