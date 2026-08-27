# Agent Note: Desktop legacy stylesheet sits in a cascade layer below the web GUI

Status: implemented

English | [中文](2026-08-24-desktop-legacy-styles-cascade-layer.zh.md)

## Problem

The desktop renderer mounts the Cordis web GUI (its own `--dsw-*` design system, CSS Modules) into the same tree that `apps/desktop/src/renderer/styles.css` styles with bare element selectors. Those globals both beat and leak into the GUI's single-class module rules: `button:hover` (element + pseudo-class) outranks a module's lone class, so a hovered plugin-settings card header was painted dark navy (`--surface-hover`) under dark text, and `button { height: 32px }` — a property the module never declares — clipped the card's two-line header to 32px. Every GUI button in the desktop shell inherited the same dark hover; the plugins panel was simply where it was reported.

## Decision

The whole legacy sheet sits in `@layer workbench` (`apps/desktop/src/renderer/styles.css`): layered rules lose to every unlayered rule regardless of specificity, so GUI module classes win wherever they declare a property, while the desktop's own class-based components — all inside the same layer — keep their internal specificity relationships unchanged. Two leaks a layer cannot fix get explicit declarations: `button { height: 32px }` becomes `min-height: 32px` so it cannot clip taller content, the plugin card header declares `white-space: normal` against the inherited `nowrap`, and the field-level reset button declares `min-height: 0` so the button base cannot stretch its badge row.

## Alternatives considered

- **Scope the element selectors to the sign-in gate and user-menu roots** — rejected: desktop slot occupants (sidebar, assistant panels) render bare `<button>`/`<input>` elements inside the Cordis tree and depend on the globals; scoping would unstyle them.
- **Per-component defensive declarations only** — rejected: heals the reported panel but leaves every other GUI button's dark hover, and each undeclared-property leak stays a game of whack-a-mole.
- **Replace the bare `button` selector with a shared class across desktop features** — the correct long-term hygiene, but a thirty-site refactor of in-flight renderer files to fix a styling regression; the layer achieves the same separation at two lines.

## Consequences

- Every GUI component inside the desktop shell now renders its declared properties as designed — hover backgrounds, borders, and typography are healed app-wide, not only in the plugins panel.
- Undeclared-property leaks remain possible by construction: a layered global still applies where a GUI module declares nothing. Each observed case is a one-line local declaration, as the two shipped here show.
- Desktop-internal styling is unaffected: rules move between layers only relative to the GUI bundles, never relative to each other.

## Testing

- `pnpm --filter @deepseek-harness/desktop run build:renderer` bundles the layered sheet.
- `npx vitest run packages/client/ui-settings-plugins` — the component suite (`section.client.spec.tsx`, 26 tests) passes; the `apply.client.spec.ts` failures pre-date this change on the xiaowei branch (`FiberState` resolution in `scripts/test-invariants.ts`) and reproduce with these edits stashed.
- A running Electron shell verifies the Plugins tab before and during pointer hover: `background-color` remains transparent in both states, and the active underline remains visible.

## Related

- [Desktop post-login user menu](../architecture/2026-08-24-desktop-post-login-user-menu.md) — the sibling-root chrome the same stylesheet serves
