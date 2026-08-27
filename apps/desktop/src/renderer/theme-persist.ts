/**
 * Theme pre-paint.
 *
 * Mirrors `packages/client/ui-theme/src/boot-theme.ts`. Applies the product's
 * fixed light theme before React mounts and removes `data-ds-dark-theme` from
 * the document. Without this first paint flicker occurs because the
 * stylesheet tokens depend on the attribute.
 *
 * The theme plugin (`ui-theme.apply`) takes over after mount, observing
 * its own snapshot store and reconciling any drift on `theme/change`.
 */
export type ThemeMode = 'light'

const DEFAULT_MODE: ThemeMode = 'light'

/** Idempotent — safe to call from `main.tsx` on every boot. */
export function installPersistedTheme(): ThemeMode {
  if (typeof document === 'undefined') return DEFAULT_MODE
  document.documentElement.removeAttribute('data-ds-dark-theme')
  document.body.removeAttribute('data-ds-dark-theme')
  document.documentElement.style.colorScheme = 'light'
  return DEFAULT_MODE
}
