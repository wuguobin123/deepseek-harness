# @deepseek-ai/dsh-client-locale

English | [中文](README.zh.md)

Locale plugin: LocaleRuntime starts the shipped client in Chinese, publishes `locale/change` for programmatic switches, and points `<html lang>` at the active locale (`zh-CN`/`en`) on activation and on every switch. The product registers no Language settings row or Host locale setting; browser language and legacy `locale.preference` values do not change the product locale. The service still exposes `setLocale` for tests and extension compositions and owns the ns×locale dictionary registry (typed `register(ns, {zh, en})` checked against `LocaleNamespaceMap`, `bind(ns)`→`TranslateNS<ns>`; lookup chain ns → common → en → key). It implements the slot system's `LocaleFace` and installs itself through `ctx.slots.installLocale`, backing the framework-injected `t` standard seat (`Translate`/`TranslateNS` are ui-slots types; import them from there — this package only re-exports for dictionary owners' convenience). The [fixed product presentation decision](../../../.agents/notes/implemented/simplification/2026-08-24-fixed-chinese-light-client.md) owns the product default and removed setting.

## Model Experience

None, as the locale registry serves browser UI copy; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Some surfaces keep inline copy** — Settings rows, the sidebar, question composer, and model select use locale seats; other packages still own static text directly.
- **Registry-held text reads its translation once** — copy captured at registration time outside the slot render path (e.g. the `/model` command description in the command registry) keeps the language it was registered under until re-registration; slot-rendered copy follows switches live.
