# @deepseek-ai/dsh-ops-workbench-conversations

English | [中文](README.zh.md)

Multi-turn conversation surface for the ops product. The package isolates tenant/actor state, streams session messages, and projects session events to SSE consumers on top of the dsh `core/session` and `session-persistence-sqlite` packages. It reserves the `ctx.conversations` projection so a future TS consumer can read conversation history or attach SSE consumers without waiting for a new scenario to land end-to-end.

Today the plugin is a no-op skeleton; the conversations projection lands with the first scenario that needs multi-tenant chat history.

## Plugin

Function plugin that injects `sessions` and exposes no runtime state today. Mount it through a `cordis.patch.yml` row when the first scenario that needs a conversations projection is接入ed.

## Config

Empty. Config lands with the first scenario.

## Model Experience

None. The plugin registers no service and emits no event; mounting it does not change the model's request prefix.

## Known Limitations and Deferred Work

- **Skeleton only** — `ctx.conversations` is reserved but not registered. The conversations projection lands with the first scenario that needs multi-tenant chat history.
