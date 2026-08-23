# @deepseek-ai/dsh-ops-loop-guard

English | [中文](README.zh.md)

Extends `@deepseek-ai/dsh-guard-repeat-tool-reminder` with the five-class loop detection the ops product needs:

1. **exact repeat** — identical tool call replayed without change.
2. **ping-pong** — alternating pair of tool calls with no progress.
3. **fatigue** — rapid repeated calls regardless of equality.
4. **research stagnation** — RAG queries without downstream consolidation.
5. **unknown capability repeat** — calls to capabilities not in the registered manifest.

The skeleton ships a no-op `apply`; the five detectors land with the first scenario that triggers them. This package reserves the surface and the companion invariant so the parent reminder service can be extended without an interim chord.

## Plugin

Function plugin with `inject: ['repeatToolReminder']` and no runtime state. Mount it through a `cordis.patch.yml` row when the first scenario that triggers one of the five detection classes is接入ed.

## Config

Empty. Config lands with the first detector.

## Model Experience

None. The parent turn sees a single advisory warning identical to the parent reminder plugin; no schema change is introduced.

## Known Limitations and Deferred Work

- **Skeleton only** — detectors land with the first scenario that triggers them.