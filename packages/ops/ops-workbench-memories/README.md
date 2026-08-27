# @deepseek-ai/dsh-ops-workbench-memories

English | [中文](README.zh.md)

Phase 1 skeleton for the ops workbench memories adapter. The package adapts the OpenViking memory store for the ops product: it auto-extracts memories from completed turns, persists them as Markdown, and surfaces them through `ctx.memories`.

Today the plugin is a no-op. The OpenViking adapter lands with the first scenario that needs cross-session memory, together with its storage backend and extraction contract.

## Plugin

Function plugin that declares `inject: ['sessions']` so the future OpenViking adapter can attach to the session lifecycle. Mount it through a `cordis.patch.yml` row when the first cross-session memory scenario is接入ed.

## Config

Empty. Config lands with the OpenViking adapter.

## Model Experience

None, as the current skeleton registers no service, event, prompt, or tool.

#### KV Cache effect

None. Mounting the skeleton does not change the request prefix.

## Known Limitations and Deferred Work

- **Skeleton only** — `ctx.memories` is reserved but not registered. The OpenViking adapter lands with the first scenario that needs cross-session memory.
