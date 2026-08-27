# Agent Note: New-session page omits the preset selector

Status: implemented

English | [中文](2026-08-25-new-session-page-omits-preset-selector.zh.md)

## Problem

The new-session page placed an agent-preset selector beside the workspace picker. Its one-shot choice required a dedicated slot, component, roster store, and staging lifecycle that waited for a blank session before calling `agentPreset.select`. This duplicated the persistent General setting for a choice most users expect the deployment to make consistently.

## Decision

The new-session page renders only the workspace picker and uses the host's effective default preset when it starts a session. `@deepseek-ai/dsh-client-ui-agent-preset` does not register `conversation.hero.agentPreset`, and `dsh-client-ui-conversation` does not declare or render that slot.

The General settings row remains the persistent way to choose the default for later sessions. The session header keeps its read-only preset label, and the host API, logged `agent-preset/selected` event, and blank-session recomposition behavior remain available to non-hero callers.

## Alternatives considered

**Hide the selector with CSS.** The inaccessible control, slot, staging store, network reads, and tests would remain active. Removing the registration and declaration makes the product behavior and client contract agree.

**Replace the selector with a static default label.** The label would add mode chrome without enabling an action. The session header already reports the preset once that information is useful.

**Remove all preset UI.** The General row still provides a useful persistent deployment preference, and the header label explains the composition of resumed sessions. Removing those would discard context rather than only the per-session override.

## Consequences

Users cannot override one new session's preset from the hero. They change the default in General settings when they want later sessions to use another preset. The client no longer owns a staged preset choice or a hero preset slot, while external callers retain the host's blank-session selection API.

Package tests assert that only the General row and header label register. The Web E2E hero snapshot contains only the workspace picker and confirms that the connected session uses the configured `standard` default. The generated client catalog omits `conversation.hero.agentPreset`.
