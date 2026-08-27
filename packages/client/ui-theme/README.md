# @deepseek-ai/dsh-client-ui-theme

English | [中文](README.zh.md)

Theme plugin: ThemeRuntime over the --dsw-* token base stylesheets (static scale + alias semantic layers). The shipped client and Host bootstrap start directly in `light`; the product registers no Appearance settings row or Host theme setting, and ignores legacy `ui-theme.preference` and desktop `dsh.theme` values. The service publishes immutable `ThemeSnapshot`s on `theme/change` and never touches the DOM — ui-layout's presenter applies the resolved snapshot (`html { color-scheme }`, `body[data-ds-dark-theme]`, and inline alias tokens). Programmatic `setTheme` and third-party theme registration remain in-process extension APIs, including `system` resolution through `prefers-color-scheme`. The [fixed product presentation decision](../../../.agents/notes/implemented/simplification/2026-08-24-fixed-chinese-light-client.md) owns the product default and removed setting.

When the host composition includes an HTTP server, the host half injects a synchronous light bootstrap immediately after the opening `<body>` tag, then sets `color-scheme` and clears `body[data-ds-dark-theme]` before the shell loading page renders. Compositions without an HTTP server remain unaffected, and ThemeRuntime and ui-layout remain authoritative for client state and subsequent DOM updates after the plugin tree activates.

`src/styles/` holds five sheets imported in order by ui-theme's dynamic client entry: `base.css`, `design-platform.css`, `scrollbar.css`, `gradient-shadow-text.css`, and `shiki.css`. The client bundle compiles and injects them as plugin-owned global styles, so unload and HMR remove them with ui-theme instead of leaving theme CSS in the static web shell. `scrollbar.css` is the sole consumer of the `--dsw-alias-scrollbar-*` tokens and must follow `design-platform.css`, which declares them.

Scrollbar rebinding contract: `scrollbar.css` binds `--dsh-scrollbar-thumb` and `--dsh-scrollbar-thumb-hover` on `body` to the l1 (base-surface) tokens, and both rendering paths read that pair. An elevated surface (menu, popover, dialog) sets `--dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2)` and `--dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2)` on its own container; one rebind retints whichever path the engine took. The pair's other legal target is `transparent`, which draws no thumb at all — [ui-sidebar](../ui-sidebar/README.md) rebinds its column that way while the pointer is elsewhere. A rebind to the l1 pair is not a rebind; it restates the base-surface default. `--dsh-scrollbar-width` mirrors the WebKit bar's layout width for surfaces that align themselves beside a space-consuming bar — [ui-conversation](../ui-conversation/README.md) reads it for the overlay composer seat's `right` offset — and the scrollbar-styles spec pairs it with the mirrored rule and the consumer.

The two paths are mutually exclusive by construction. `scrollbar-width`/`scrollbar-color` sit inside `@supports not selector(::-webkit-scrollbar)` because a non-`auto` value of either makes Chromium and Safari discard every `::-webkit-scrollbar*` rule for that element, `::-webkit-scrollbar-thumb:hover` included — declaring both unconditionally leaves `--dsh-scrollbar-thumb-hover` with no rendering anywhere. Firefox therefore takes the standard properties and WebKit-based engines take the pseudo-elements, so the hover token only ever renders through the pseudo-element path. Reasoning and the measured computed values: [the scrollbar Agent Note](../../../.agents/notes/implemented/bug-fix/2026-07-28-themed-scrollbars-and-reserved-gutter.md).

## Model Experience

None, as the theme service manages browser presentation state; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Third-party themes are an extension point, not a product** — registering one means overriding same-named alias variables; no validation exists that an override set is complete.
- **The token sheets are the sole color authority** — values absent from cssdesign (for example the design's #4176E6 tab blue) are deliberately not appended; the nearest semantic token wins. Design-owner-approved additions are the exception and enter as a static step plus a semantic alias in the same change (`--dsw-static-blue-900` / `--dsw-alias-label-primary-bluish`).
