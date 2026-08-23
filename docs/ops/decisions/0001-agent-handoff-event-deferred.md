# 0001 — `agent/handoff` session event deferred

Status: deferred
Date: 2026-08-22
Owner: ops-runtime (future)

## Context

Phase 0 P0.3 of the migration plan called for adding an `agent/handoff` session event to `KNOWN_SESSION_EVENT_TYPES` so an orchestrator can record "this turn's logical ownership transferred from agent A to agent B." The event would let dashboards and projection folds reconstruct the handoff trail without scraping every `subagent/descriptor` plus `agent/inbox/inserted` pair.

## Decision

Defer. The event will be added when a real producer lands, not before.

## Why

`KNOWN_SESSION_EVENT_TYPES` is generated from `SessionEventMap` declaration merging across the repo. The persistence read path refuses to interpret any event type outside that set unless the envelope carries `ignorable: true` ([mechanism](../../.agents/notes/implemented/architecture/2026-08-10-session-log-version-mechanism.md)). A new event type without a producer declaration:

1. Would be a dangling declaration; the catalog verifier `verify-persistence-catalog` rejects declarations that no `SessionEventMap` member produces.
2. Could not be safely emitted by any code path that does not yet exist.
3. Risks attaching semantics to a name that the eventual producer may not match — every consumer built against the premature shape would need a migration.

The pre-release stance in [`AGENTS.md`](../../../AGENTS.md) — "prefer the correct foundation over compatibility shims" — applies. There is no current consumer.

## Producer that will reintroduce it

`packages/ops/ops-runtime` (when a business scenario decides to use an orchestrator-driven handoff). The candidate shape:

```ts
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'agent/handoff'(
      this: Scoped<Agent>,
      payload: {
        from: Agent
        to: Agent
        reason: 'orchestrator-decision' | 'delegation' | 'failover'
        payloadRef: { sessionId: SessionId; sequence: number }
      },
    ): void
  }
}
```

The `to` agent must already exist (a subagent publication or a `ctx.agents.create()` for an orchestrator); handoff is a relationship declaration, not a creation primitive. The event stays in the log; it is not a `surfaceOp` and never enters model history.

## Until then

- `subagent/descriptor` covers child publication and remains the authoritative signal that a child agent has been published under a parent session.
- `agent/inbox/inserted` + `agent/inbox/claimed` cover turn transitions inside one agent.
- `agent.inject()` ([`core/agent-loop/src/agent.ts:130-132`](../../../packages/core/agent-loop/src/agent.ts)) is the mechanism that delivers a cross-agent message; no new event is required to use it.

When `ops-runtime` lands, this decision document moves to `.agents/notes/implemented/process/` and the event declaration lands together with its producer.
