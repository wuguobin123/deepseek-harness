# Agent Note: Xiaowei composes the agent-preset plane

Status: implemented

English | [中文](2026-08-24-xiaowei-agent-preset-composition.zh.md)

## Problem

The Desktop renderer mounts the same `ui-agent-preset` plugin as WebUI, but the `xiaowei` profile was composed from `dsh-base`, `dsh-headless`, and `dsh-xiaowei` without the `agent-presets` service. `agentPreset.list` therefore returned the valid no-roster response, and the settings section hid its unavailable content while its registered navigation row remained visible. Adding only the roster would have been incorrect: the base layer's model-visible plugins would still have been global, so presets could add capabilities but could not remove them.

## Decision

The Xiaowei bundle applies the same [host-plane and agent-plane split](../architecture/2026-08-03-per-session-agent-presets.md) as the Web bundle without importing the Web application's startup, browser roster, or server rows. It disables the base model-visible rows that the shipped preset compositions own, inserts `@deepseek-ai/dsh-agent-presets` with `standard` as the composition default, and declares that package as a direct dependency. The CLI profile composer sees the roster row and supplies the shipped preset root, so WebUI and Desktop read the same live roster through `agentPreset.list`.

## Testing

The real-composition regression boots the Xiaowei bundle layers with external side effects disabled. It asserts that the host tool layer is empty, the shipped roster is available, and `standard` and `minimal` agents receive different scoped tool catalogs.

## Alternatives considered

**Render an empty-state message in Desktop.** The section correctly reports a deployment with no roster as unavailable. A message would describe the missing capability without making preset selection work.

**Insert only `agent-presets`.** Rejected because the base model-visible rows would remain global. A `minimal` session would retain the full host tool catalog, violating the preset choice.

**Layer `dsh-web-app` into the Xiaowei profile.** Rejected because that bundle also owns Web startup, the browser plugin roster, storage, connection, gateway, and server rows that Xiaowei already supplies with product-specific configuration.

## Consequences

Xiaowei sessions are composed from a preset instead of inheriting one process-global agent toolset. The settings page, new-session picker, and session label now reflect the same host roster. The shipped preset persona shadows the Xiaowei deployment persona for its session, matching the existing per-session persona rule; a product-specific default persona requires a product-specific preset rather than a second host-level tool composition.
