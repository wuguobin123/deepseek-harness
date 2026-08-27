# Agent Note: Desktop assistant — exhaustive `turn/end`, symmetric subscription, tool + user-questions rendering

Status: implemented

English | [中文](2026-08-23-desktop-assistant-2-query-stall-and-tool-rendering.zh.md)

## Problem

The Electron desktop client at `apps/desktop/` runs its Assistant page off a single `/api/events.mux` WebSocket downlink. The reducer in `apps/desktop/src/renderer/features/assistant/AssistantContext.tsx` collapsed every terminal signal into one of three branches — `reason.kind ∈ {error, completed, cancelled}` — and ignored everything else, so any `turn/end` frame the host emitted with a different `reason.kind` (tool-loop short circuits, model/throttled subclasses, malformed envelopes) silently stranded `state.running = true`. Because `AssistantPage.sendDraft` (`apps/desktop/src/renderer/features/assistant/AssistantPage.tsx:64`) early-returned on `state.running`, every later send in the session was a dead click — the user message never rendered, no error surfaced. The bug was reproducible from a fresh session after exactly two working prompts.

The same `AssistantContext` exposed `attachSession` to the page through a side-effect-mutating `AssistantBridge` sub-component — the function was already on the context value, so the bridge was a redundant render-time patch that made subscription lifecycle harder to reason about under StrictMode double-mounts.

The desktop Assistant also collapsed every non-text frame that the host emitted: `tool-call` / `tool-result` activity was folded away by the existing handler (`AssistantContext.tsx:147-180`), and `user-questions/requested` envelopes had no path into the composer at all. The webUI (`packages/client/*`) renders both as inline tool cards and a multi-question form takeover; the desktop, by being a strict subset, hid the actions the assistant actually took and offered no way to answer the host when it asked.

## Decision

`AssistantContext.tsx` now branches `turn/end` exhaustively: `error` dispatches `'error'`; `completed` / `cancelled` dispatch `'final'`; anything else dispatches `'final'` with a `console.warn` so an unknown `reason.kind` is diagnosed but never strands the composer. The reducer union gains three new action types — `'tool/event'`, `'questions/pending'`, `'questions/answered'` — backed by two new state slices, `tools: ToolEvent[]` and `pendingQuestions: UserQuestionsRequest | null`, on `AssistantTurnState` (`apps/desktop/src/renderer/features/assistant/types.ts`). The page's `useEffect` cleanup calls a new `detach()` method that awaits the existing `unsubscribeRef.current` and clears the ref, mirroring the symmetric teardown at the provider level. The `AssistantBridge` redundant sub-component is removed; `useAssistant` reads `attachSession` straight off the context value.

The MuxFrame handler dispatches `tool-call` / `tool-result` (`tool-call`, `tool/call`, `tool_call`; `tool-result`, `tool/result`, `tool_result` — host names differ across versions) into a single `ToolEvent` slice, collapsing the three accepted aliases per event into the same reducer path. `user-questions/requested` (and its three alias spellings) build a `UserQuestionsRequest` carrying `callId`, optional `header`, and `questions[]`; submission calls `api.respond(callId, { answers })` and dispatches `'questions/answered'` so the textarea returns.

`apps/desktop/src/renderer/features/assistant/ToolCard.tsx` (new) renders one inline card per tool invocation: chevron + tool name + status pill (`running` / `completed` / `failed` / `cancelled`) + elapsed time, collapsed by default, click to reveal pretty-printed input / output JSON. `apps/desktop/src/renderer/features/assistant/UserQuestionsForm.tsx` (new) renders one `<fieldset>` per question with one radio option per choice and a gated submit button; selection collects `{ [questionId]: optionLabel }` and forwards via `onSubmit`.

`AssistantPage.tsx` splices `<ToolCard>` rows from `state.tools` between the message list and the composer; while `state.pendingQuestions` is non-null it renders `<UserQuestionsForm />` in place of the textarea and disables the send button. CSS lives at the end of `apps/desktop/src/renderer/styles.css`, reusing `--accent`, `--border`, `--surface-inset`, `--err`, `--radius-l`, `--font-mono`, and the existing `.badge--{running|completed|failed|killed}` variants (lines 1355, 7497-7516). No new tokens, no new palette.

## Alternatives considered

**Stop fixing the bug in the renderer and update `dsh-ops` instead.** Rejected because the host's `reason.kind` set is the authority — the right thing to do is fix every authoritative terminator in the host, but until then the renderer must not strand its composer. The exhaustive branch and the `console.warn` make the failure mode visible at the renderer, which is the correct locality for a fallback that owns its own defensive guard.

**Move tool / questions frames into the existing `messages` array as inline typed variants.** Rejected because the host emits `tool-call` / `tool-result` out-of-band of `assistant/chunk`, so the splice boundary is the turn rather than any single message. A separate `tools` slice matches the webUI's `tool.call.toolview` keyed-by-name shape and keeps `Message` narrow.

**Pull in `@deepseek-ai/dsh-client-ui-tool` / `@deepseek-ai/dsh-client-ui-user-questions` from the webUI workspace.** Rejected because the user explicitly scoped Phase 1 to re-implementing the interactions in the desktop's existing React tree. Wholesale component reuse would have added 16+ workspace dependencies and shifted the desktop onto the cordis runtime — a much larger surface than the two pages this note ships.

**Add a WebSocket reconnect loop with capped retries around `api.subscribeMux`.** Rejected because the main process's `startStream` handler already surfaces a `stream/error` frame on idle timeout (`apps/desktop/src/main/ipc-handlers.ts:140-154`), and the renderer's existing `'error'` reducer branch turns that into a `page-assistant__error` banner. Adding a renderer-side retry would mask the surfaced error and risk double-subscribing through `preload/index.ts:52-71`. The exhaustive `turn/end` fix plus symmetric `detach()` is sufficient for the reproducible symptom; reconnect stays a follow-up if the idle-drop frequency becomes a complaint.

## Consequences

A turn ends no matter what `reason.kind` the host emits — the composer is always released, and the `state.running` guard at `AssistantPage.sendDraft` no longer strands later sends. CDP verification on the running desktop sends four prompts back-to-back with proper spacing and confirms 4 user messages + 4 assistant responses land, with the status pill returning to "空闲" after every turn and no `page-assistant__error` banner. StrictMode double-mount is symmetric — the provider's `useEffect` cleanup plus the page's new `detach()` both call the same `unsubscribeRef.current` disposer, so the preload's IPC listener registration cannot leak across remounts.

Tool activity now appears as inline cards beside the messages they belong to, with running / completed / failed / cancelled status pills matching TasksPage's existing badge vocabulary. Pending user-questions take over the composer with a radio form; submission posts back through `api.respond` so the host can resume. The user-facing surface gains two new visual elements without pulling in any of the `@deepseek-ai/dsh-client-ui-*` packages.

Verification ran via CDP against the live Electron build at the already-installed debug port (`/tmp/dsh-assistant-verify.mjs`); tests remain at the 9/9 baseline from the prior contract suite and no test fixtures were added because the change is interactive rather than purely functional. Phases 2+ (message feedback, attachment rail, sidebar restructure, settings sections, theme toggle) remain deferred.
