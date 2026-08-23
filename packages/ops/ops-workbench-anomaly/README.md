# @deepseek-ai/dsh-ops-workbench-anomaly

English | [中文](README.zh.md)

Phase 1 skeleton for the ops workbench's anomaly detection surface. The package detects session and turn anomalies and exposes them through `ctx.anomalies` so the workbench can flag, triage, and respond to abnormal session behavior.

Today the plugin is a no-op; the anomaly detectors land together with the first scenario that needs anomaly surfacing. Mount it through a `cordis.patch.yml` row when that scenario arrives.

## Plugin

Function plugin with `inject: ['sessions']` so detectors can read session state once the first scenario lands. Mount it through a `cordis.patch.yml` row when anomaly surfacing is接入ed.

## Config

Empty. Config lands with the first scenario that needs anomaly surfacing.

## Model Experience

None. The plugin registers no service and emits no event; mounting it does not change the model's request prefix.

## Known Limitations and Deferred Work

- **Skeleton only** — anomaly detectors land with the first scenario that needs them.
