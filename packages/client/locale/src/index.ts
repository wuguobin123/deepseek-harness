/** Host half for selecting the Chinese-default browser locale client. */

import type { Context } from '@deepseek-ai/cordis'

export {
  LOCALE_IDS, LOCALE_PREFERENCE_FIELD, LOCALE_SETTINGS_NAMESPACE,
  type LocaleId, type LocaleSettings,
} from './locale-settings.ts'

/**
 * The product exposes no Host language setting; the function plugin remains
 * as the package entry that selects the browser client half.
 * @param _ctx - Host context unused by the fixed-locale entry.
 */
export function apply(_ctx: Context): void {}
