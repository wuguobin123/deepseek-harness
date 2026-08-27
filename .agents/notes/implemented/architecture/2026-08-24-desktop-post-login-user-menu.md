# Agent Note: desktop account footer and release status

Status: implemented

English | [中文](2026-08-24-desktop-post-login-user-menu.zh.md)

## Problem

The desktop removed its sign-in gate after authentication, so the workbench did not identify the current user. Account balance was available through `account.wallet.get` but appeared only in an unmounted settings component. The update checker always reported up to date even though the release script published `/releases/latest.json`. Sign-out also appeared in the sign-in component instead of having one stable home.

## Decision

The desktop registers one deployment-owned component in `sidebar.footer.action` and one Account section in `settings.section`. The sidebar renders Settings before footer actions, placing the avatar row at the physical bottom. The expanded row shows the display name and formatted MiniMax allowance; its popover shows the opaque user id, balance, and available release. The collapsed row retains the avatar and update dot. The account popover contains no sign-out control. Settings → Account owns the only reachable sign-out button.

Registration uses the existing slot ledger rather than a sibling React root. The account chrome is therefore disposed with the Cordis renderer and follows the sidebar's wide or rail geometry.

The popover portals to `document.body` while retaining a measured fixed anchor beside the footer row. This avoids the sidebar column's intentional `overflow: hidden`. Account cards use section-scoped light-shell styles so legacy desktop surface tokens do not produce dark cards inside the shared Settings modal.

The main process fetches and validates `/releases/latest.json` at startup and every four hours. It compares the current semantic version, selects the current platform artifact, and publishes the typed `AppUpdateState` over existing IPC. A manual check reports whether the installed version is current instead of completing without visible feedback. The explicit update action launches fixed, main-process-owned installer scripts on macOS and Windows; the renderer and release manifest cannot supply commands. Linux retains a browser download and accepts only a package URL whose origin matches the configured service origin.

Xiaowei registration grants `20_000_000` micros once through the wallet's idempotent `welcome:<userId>` key. Daily refresh remains configurable but defaults to zero. The renderer reads that balance; model-call pricing and debit remain a separate wallet consumer because the wallet cannot infer whether a request used a platform MiniMax credential or BYOK.

## Alternatives considered

- A fixed top-right sibling root would reproduce the reference pill but would sit outside the sidebar slot lifecycle and would not satisfy the requested bottom-left placement.
- Keeping sign-out in the account popover would make the action easy to reach, but it would create a second location and conflict with the Settings-only requirement.
- Treating every wallet balance as already metered MiniMax spend would overstate the implementation. Provider selection, token prices, reservation, settlement, and BYOK exclusion belong to a dedicated model-call consumer.

## Consequences

The current identity, balance, and update state stay visible without opening Settings. Update checks use the same service origin and release manifest already produced by packaging. New accounts receive one 20 CNY grant instead of an implicit recurring daily grant. Actual MiniMax token charging is not supplied by the presentation change; a deployment that enables platform billing must install the debit consumer before describing the balance as enforced spend.
