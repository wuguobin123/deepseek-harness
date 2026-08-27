/** Machine value of the preset that requires an explicit GUI risk gate. */
export const FULL_ACCESS_PRESET = 'danger-full-access'

/**
 * Convert conventional kebab-case preset names into user-facing title case.
 * @param name - host-supplied preset label or key.
 * @returns the title-cased conventional key, or a non-kebab label unchanged.
 */
export function displayPresetName(name: string): string {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) return name
  return name.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

/**
 * Render a built-in permission preset through the active locale while
 * preserving unknown Host-configured names.
 * @param value - preset machine value.
 * @param name - host-supplied preset name.
 * @param t - optional active-locale lookup; absent controller state stays locale-neutral.
 * @returns the localized built-in label or the supplied custom name.
 */
export function displayPermissionPreset(
  value: string,
  name: string,
  t?: (key: 'preset.readOnly' | 'preset.workspaceWrite' | 'preset.fullAccess') => string,
): string {
  switch (value) {
    case 'read-only': return t?.('preset.readOnly') ?? displayPresetName(name)
    case 'workspace-write': return t?.('preset.workspaceWrite') ?? displayPresetName(name)
    case FULL_ACCESS_PRESET: return t?.('preset.fullAccess') ?? displayPresetName(name)
    default: return name
  }
}
