# Agent Note: Continue output-limited Xiaowei turns automatically

Status: implemented

English | [中文](2026-08-26-bounded-max-token-continuation.zh.md)

## Problem

Xiaowei's MiniMax route can end a response with the native stop reason `length`. The adapter correctly projects that fact as `max-tokens`, and the agent loop closes the turn without dispatching any incomplete tool call. Production evidence showed one website task ending this way four times. Several responses spent their available output on planning text and never reached the promised build tool, so the user had to send “continue” after every cutoff.

Raising the configured request limit does not solve a provider-owned ceiling, and treating truncation as success would hide incomplete work. The recovery must preserve every capped turn while continuing the task without an unbounded token loop. It extends the existing [max-tokens chat notice](2026-08-12-max-tokens-turn-end-notice.md), which remains the durable presentation owner.

## Decision

`@deepseek-ai/dsh-max-token-continuation` uses the existing `agent/turn-stopping` extension point. When the latest finish chunk in the closing turn is `max-tokens`, the guard queues a separate plugin-sourced continuation turn. Its fixed prompt tells the model to resume at the cutoff, avoid repeated planning or status-only replies, preserve completed work, and issue the next required tool call immediately. Large HTML, document, spreadsheet, table, and code tasks prioritize completing and saving the artifact through the available artifact or file tools.

`maxContinuations` bounds consecutive automatic turns and fails loud unless it is a positive integer. The guard rebuilds its ordinal and handled-turn set from durable session events. `agent/session-start { source: 'resume' }` recreates one continuation when the capped `turn/end` persisted before its queued message was claimed; a later `turn/start`, an existing continuation for the same `fromTurn`, or queued caller work prevents duplication. A normal completion or direct human message resets the chain. Xiaowei configures the limit through `XIAOWEI_MAX_TOKEN_CONTINUATIONS`, defaulting to eight.

The loop remains unchanged. Every capped turn retains `turn/end { reason: { kind: 'max-tokens' } }`; the new turn and its `{ cause, fromTurn, ordinal, limit }` source metadata are ordinary durable session events. An incomplete tool call stays discarded and must be emitted again in complete form by the next response. The conversation client hides the internal continuation prompt and annotates the owning max-tokens notice with automatic progress; old logs without the metadata retain the manual guidance.

## Alternatives considered

**Increase `maxTokens`.** The production request already advertised a larger route default than the provider delivered. A provider ceiling remains authoritative.

**Preempt near the estimated limit.** Most providers expose reliable usage only with the terminal finish chunk. Aborting a stream early can discard a partially emitted tool call without proving that the provider would have reached its cap, so continuation starts only from the exact `max-tokens` reason.

**Continue inside the same turn.** The loop intentionally keeps `max-tokens` sticky across later steps. A separate turn preserves that contract and matches the existing manual recovery.

**Retry the same provider request.** Retrying with the same history can reproduce the same long planning output and cannot safely reconstruct a truncated tool call.

**Continue without a cap.** A model that repeatedly consumes its whole allowance would create an unbounded cost and latency loop.

## Consequences

Long Xiaowei tasks continue without user intervention through ordinary output truncation. The transcript keeps each capped turn plus a collapsed notice showing the automatic continuation count. After eight consecutive automatic continuations by default, the agent becomes idle and manual recovery remains available. Every continuation consumes another model request and retained-history tokens.

Focused real-loop tests cover successful recovery, the hard cap, normal completion, invalid configuration, restart recovery, duplicate resume events, and caller priority. The authored ACP snapshot cuts a tool call mid-arguments, proves the incomplete call never executes, automatically starts a new turn, reissues the complete call, writes the file, and finishes within one client prompt lifecycle.
