/** Host registration for the fixed pre-plugin light palette. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { bootThemeInjection } from './boot-theme.ts'
import { DEFAULT_PREFERENCE } from './theme-settings.ts'

export {
  DEFAULT_PREFERENCE, THEME_PREFERENCE_FIELD, THEME_PREFERENCES, THEME_SETTINGS_NAMESPACE,
  type ThemePreference, type ThemeSettings,
} from './theme-settings.ts'

/**
 * Answer every index injection collection with the fixed light bootstrap row.
 * @param ctx - Host context serving the browser entry.
 */
export function apply(ctx: Context): void {
  ctx.on('webserver/index-inject', (table) => {
    table.push(bootThemeInjection(DEFAULT_PREFERENCE))
  })
}
