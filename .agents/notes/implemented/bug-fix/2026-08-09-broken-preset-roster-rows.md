# Agent Note: Broken presets are roster rows, not gaps

Status: implemented

English | [中文](2026-08-09-broken-preset-roster-rows.zh.md)

## Problem

With files as the only composition editor, hand-edit damage had two failure shapes and both were silent until the worst moment. A preset whose `agent.cordis.yml` no longer parsed listed as a perfectly ordinary row — selectable, copyable, settable as the default — and failed only when the next session tried to mount it; set as default, every new session failed to start. A directory whose composition file was deleted outright vanished from the roster while still occupying its id on disk: `copy` refused the name with "delete the existing preset first" and `remove` answered "not found" — two contradictory errors with no way out short of hand-deleting the directory.

## Decision

Discovery owns health, and a damaged directory is a **roster row carrying a `broken` reason**, never a gap. `scanRoot` treats every directory whose name is a usable preset id as a preset slot: composition missing → broken ("still occupies the id; delete it or restore the file"), composition unreadable/unparsable/not-a-list-of-named-rows → broken with the parser's first line. The shape check parses with the loader's own `entryListSchema` (the `!!js` dialect), so health can never call broken what the loader would accept; directories whose names fail `PRESET_ID` are skipped outright, because no copy could ever collide with them. `broken` rides `AgentPreset` and the `agentPreset.list` wire entry. Mounting paths (`mount`/`recompose`/`standingKeyFor`) refuse a broken preset up front via `resolveMountable` with the discovery-reported reason; `resolve` still answers because authoring callers need to read, repair, report, or remove the occupied id, and `copy`'s roster check sees the collision.

The General client picker drops broken presets through `presetOptions`. It chooses the default for later sessions, and offering one that cannot compose would only defer the failure. Authoring agents and service clients consume the complete roster, including the reason and occupied id.

## Consequences

- The ghost dead end is gone in the authoring service: the directory lists broken, `remove` clears it, and the freed id is immediately claimable (covered by package and CLI e2e tests).
- A default that later breaks still fails the session start loudly — the picker hides broken rows, but nothing rewrites a stored default; `resolveMountable`'s early refusal is the same message every unloadable shape gets, instead of loader-dependent errors.
- Health runs on every `list()`: one read+parse per preset per roster read, accepted for the same reason unmemoized discovery was — rosters are small and freshness is the contract.
- `copy` stays shape-agnostic. A caller can duplicate a broken source, and the copy remains a broken roster row that mount paths refuse; repair or removal is the useful authoring action.

## Load-bearing details

- **`PRESET_ID` moved to `types.ts`** so discovery and authoring share one containment vocabulary; authoring re-exports it unchanged.
- **The reason is one line.** js-yaml appends a multi-line code-frame snippet; `compositionProblem` keeps the wire diagnostic concise for every roster consumer.
- **Two mount.spec races were left untouched deliberately**: `ensureStanding` is still reachable with a preset resolved just before deletion (the private-path tests), and its stamp/unstampable semantics are unchanged — the health check happens before, in the public route.
- **Creator-mode guidance owns repair.** The `cordis` preset's persona forbids editing the shipped install and points authoring at `${DSH_HOME:-$HOME/.dsh}/.agent-presets/<id>/`; its skill teaches metadata, the copy-first workflow, and [mount-validation through `standingKeyFor`](2026-08-11-preset-authoring-agent-validates-its-own-composition.md).

## Alternatives considered

Omitting broken directories from discovery but refusing the id at copy time with a better message: still gives authoring callers no row to repair or remove. Validating deep (resolving every row's module at list time): the mount already owns that failure with rollback, and per-row imports on every roster read would be neither cheap nor more actionable. Blocking `settings` writes naming a broken default: the settings domain is generic and the roster is a live directory — a name absent or broken now may be valid by the next session, and the mount's loud failure is the enforcement that owns the moment.
