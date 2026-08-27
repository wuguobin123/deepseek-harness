# @deepseek-ai/dsh-ops-workbench-trigger

English | [中文](README.zh.md)

Phase 1 skeleton for the ops workbench cross-session trigger surface. The package hosts cross-session triggers (cron + event-listening) for the ops product; session-local reminders borrow [`@deepseek-ai/dsh-schedule`](../../schedule/schedule/README.md), and this package adds the cross-session half — the `@schedule` global trigger and event subscriptions.

Today the plugin is a no-op. The global trigger implementation lands with the first scenario that needs cross-session reminders.

## Plugin

Function plugin that declares `inject: ['sessions']` so the future global trigger implementation can attach to the session lifecycle. Mount it through a `cordis.patch.yml` row when the first cross-session reminder scenario is接入ed.

## Config

Empty. Config lands with the global trigger implementation.

## Model Experience

None, as the current skeleton registers no service, event, prompt, or tool.

#### KV Cache effect

None. Mounting the skeleton does not change the request prefix.

## Known Limitations and Deferred Work

- **Skeleton only** — `ctx.triggers` is reserved but not registered. The global trigger implementation lands with the first scenario that needs cross-session reminders.
