# Agent Note: Composer Send stays beside Stop while a run has a live draft

Status: implemented

English | [中文](2026-08-24-composer-send-beside-stop-during-run.zh.md)

## Problem

While an ordinary session ran, the composer swapped its primary Send button for Stop, so submitting a typed follow-up mid-run existed only as a keyboard gesture — plain Enter under the busy-Enter preference ([queue/steer composer contract](2026-07-30-web-queue-steer-action.md)). A pointer user with a live draft saw exactly one enabled action, and that action cancelled the turn: queueing supplementary content looked unavailable even though the delivery path (`session.prompt(mode: 'queue')` into the inbox) supported it fully. The running continuable child had already solved the same presentation problem by keeping Send primary and exposing Stop as an independent button ([continuable interrupt](2026-08-06-continuable-subagent-interrupt.md)).

## Decision

InputBar derives the primary button from the draft, not from the running bit alone. An ordinary session keeps the Send/Stop toggle only while the draft is empty; with a live draft during a run the primary stays Send and Stop moves to the independent button — the continuable-child layout. The click submits through the same machine path as that layout's Send, which is always Queue: the documented rule that the send button and non-keyboard submits remain Queue is unchanged, and the busy-Enter preference keeps its keyboard-only scope. The empty-draft running state keeps the single Stop toggle with no second button, one-shot children still expose no Stop, and continuable children are untouched.

### Verification

The InputBar component spec pins all four states: empty-draft running keeps one primary Stop; a live draft during a run keeps Send beside an independent Stop, with pointer queue and pointer stop each reaching their sink; Enter queueing during a run is unchanged; and the one-shot child never renders Stop. Every assembled Web snapshot captures the running composer with an empty draft, so no recorded browser output moves.

## Alternatives considered

**Show Send and Stop side by side whenever a session runs.** Rejected because an empty draft leaves Send permanently disabled next to Stop, doubling the chrome of the common running state to carry one action; deriving from the draft keeps one primary action per state.

**Let the button follow the busy-Enter preference and Steer.** Rejected because the composer contract deliberately keeps pointer submission on Queue ([queue/steer note](2026-07-30-web-queue-steer-action.md)); steering already has the plain/accelerated Enter pair and the per-row dock action.

**Keep submission keyboard-only and document the Enter gesture.** Rejected because the capability then stays undiscoverable for pointer users on every surface that mounts the shared composer — Web and desktop both — while the only visible button inverts into a turn-cancelling action exactly when a follow-up is most wanted.

## Consequences

The shared composer gives Web and desktop the pointer queue path in one change with no protocol or Host work: the queued message rides the existing `session.prompt(mode: 'queue')` contract and surfaces through QueueDock like any queued row. The running composer's button set depends on draft presence, so tests and snapshots that assert chrome during a run must state the draft explicitly; all current assembled snapshots hold the empty-draft state and are unaffected. The continuable-interrupt note's ordinary-session toggle sentence and the ui-conversation README's submission paragraph track the shipped behavior.
