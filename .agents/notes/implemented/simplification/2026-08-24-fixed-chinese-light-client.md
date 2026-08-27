# Agent Note: Fix the product client to Chinese and light mode

Status: implemented

English | [中文](2026-08-24-fixed-chinese-light-client.zh.md)

## Problem

The product settings page exposed Language and Appearance choices even though this client is distributed for one Chinese, light-mode presentation. Those controls also made browser language, operating-system color scheme, Host settings, and desktop `localStorage` competing inputs during startup, so an old preference could override the intended product presentation or cause a mismatched first paint.

## Decision

The shipped locale client starts in `zh`, sets `<html lang="zh-CN">`, and does not register the `language` entry in `settings.general.item` or the Host `locale.preference` schema. Browser language and stored locale sections do not participate in product activation.

Every product-owned brand name, boot status, label, action, status, empty state, confirmation, and accessibility name in the shared client and Electron account shell resolves to Chinese. Permission presets map their stable wire values to `只读`, `工作区写入`, and `完全访问`; `/permission` arguments and persisted preset ids remain unchanged. Model names, provider names, tool names, protocol identifiers, commands, paths, API addresses, file formats, and user-, model-, Host-, or third-party-supplied text remain exact instead of being translated heuristically.

The shipped theme client and Host bootstrap start in `light`, do not register the `appearance` entry or the Host `ui-theme.preference` schema, and do not read the desktop `dsh.theme` key. The desktop pre-paint writes the light color scheme before React mounts, matching the later ThemeRuntime snapshot.

LocaleRuntime and ThemeRuntime keep their programmatic switching and registry APIs for tests and extension compositions. These APIs are process-local in the shipped client because product activation constructs each runtime without a settings scope. English dictionaries and the dark token palette remain available to those extensions and as fallback assets; they are not product settings.

## Verification

Package assembly tests assert the Chinese and light snapshots and the absence of `language` and `appearance` General-setting occupants. Permission, conversation, trajectory, and component tests pin Chinese labels while retaining machine values in submitted commands. Host tests assert that neither schema is registered and that every theme bootstrap embeds `light`. The desktop pre-paint test stages legacy dark storage and a dark operating-system preference, then verifies that neither input is read and the document remains light. The generated client slot catalog contains neither removed occupant.

## Alternatives considered

**Keep the controls and only change their defaults.** Existing Host or browser values would still override those defaults, and users could return the product to an unsupported presentation.

**Hide the controls only in the Electron shell.** Electron mounts the shared Web client plugins that contribute these rows, so a desktop-only component deletion would leave the actual settings page unchanged and the Web composition inconsistent.

**Delete bilingual dictionaries and the dark palette.** Runtime extensions, fallback lookup, syntax presentation, and tests still use those assets. Removing the product choices does not require removing the lower-level registry capabilities.

## Consequences

The settings General section contains only the remaining configurable rows. Web and Electron startup agree on Chinese product copy and a light first paint, regardless of browser locale, operating-system theme, or legacy preference data. Exact external text can still contain English because translating model output, names, identifiers, diagnostics, or data would corrupt source meaning. Product users give up language and theme selection; reintroducing either choice requires a new product decision and a startup path with one authoritative value source.
