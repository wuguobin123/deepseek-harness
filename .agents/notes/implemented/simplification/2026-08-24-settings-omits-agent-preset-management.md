# Agent Note: Settings omits agent preset management

Status: implemented

English | [中文](2026-08-24-settings-omits-agent-preset-management.zh.md)

## Problem

The Settings navigation exposed a dedicated Agent presets page for copying, deleting, browsing, and selecting preset compositions. This made an expert filesystem-authoring workflow a standing settings destination alongside routine account and model configuration.

The page also owned two presentation mechanisms that existed only to support that workflow. Roster cards measured and clamped arbitrary preset descriptions while preserving the full accessible text, and the Creator entry staged the `cordis` preset across screens with a reduced-motion-aware introduction cue. Both mechanisms added state, CSS, tests, and maintenance to keep one settings destination usable.

## Decision

The shipped client registers no `settings.section` entry for Agent presets. `@deepseek-ai/dsh-client-ui-agent-preset` retains the General row that chooses the default for later sessions and the read-only session-header label. It does not ship the roster-card page, copy/delete/view/location actions, Creator entry, or cross-screen introduction cue. [The new-session page omits its preset selector](2026-08-25-new-session-page-omits-preset-selector.md).

Preset authoring remains available through the agent-preset service, host APIs, CLI-oriented workflows, and direct preset files. Removing the settings page does not change preset discovery, mounting, session selection, wire methods, or the `agent-presets` settings namespace.

## Alternatives considered

**Hide the section only in Xiaowei.** This would preserve two product behaviors for the same shared client plugin and leave the management code and tests in every build. The product decision applies to the Settings information architecture rather than one profile.

**Keep a read-only preset browser.** A viewer would still reserve a navigation destination for an expert workflow while omitting the actions that made it useful. Shipped preset compositions and user-authored files remain available through their owning filesystem and agent workflows.

**Stop registering the section but keep its implementation dormant.** Dead components, locale strings, controllers, and E2E fixtures would continue to compile without a supported entry path. The removal deletes them and makes the absence explicit in the registration test and generated client catalog.

## Consequences

Users cannot copy, delete, browse, or open preset directories from Settings, and Settings no longer offers a Creator-mode authoring handoff. The remaining General selector hides presets that discovery marks broken, so a session cannot receive an unloadable default through the client.

The removed page's description clamp and introduction animation are absent rather than generalized. If a dedicated preset-management journey returns, it must define its placement and safety model first, then restore accessible overflow handling, reduced-motion behavior, destructive-action confirmation, and an end-to-end authoring test for that journey.

Package tests assert that the plugin contributes only the General row to Settings. The generated client slot catalog contains no Agent preset occupant, and the Settings chrome E2E snapshot asserts the navigation entry is absent. The dedicated Web authoring E2E and its snapshots are absent because that browser journey is not supported.
