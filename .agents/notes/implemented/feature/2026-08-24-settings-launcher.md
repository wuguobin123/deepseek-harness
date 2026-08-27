# Agent Note: Product-owned settings launcher

Status: implemented

English | [中文](2026-08-24-settings-launcher.zh.md)

## Problem

The desktop account entry needed to open a specific Settings section while the generic browser shell remained reusable.

## Decision

The settings domain declares an optional `settings.launcher` single slot. The shell supplies `wide`, `isOpen`, `openSettings`, and `openSection`, and renders its existing trigger as the fallback. Desktop registers the account row in this slot, opens `account` directly, and keeps update checking as an independent action.

## Alternatives considered

**Keep the account popover.** Rejected because it duplicates identity and Settings presentation instead of taking the user to the Account section that owns those controls.

**Replace the generic trigger without a fallback.** Rejected because Web compositions without a product launcher would lose their only Settings entry.

## Consequences

Desktop account identity is now part of the Settings launcher row; the rail keeps a separate update click target, and update clicks do not open Settings.

## Verification

Focused ui-settings-general Vitest tests, the desktop test suite, client-contract and desktop typechecks, the desktop production build, client-catalog verification, and `git diff --check` pass. The desktop DOM test pins the launcher/update order and click isolation; no packaged-Electron visual snapshot covers this product-owned launcher.
