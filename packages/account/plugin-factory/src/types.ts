/** One server-registered plugin that accounts may install. */
export interface PluginCatalogEntry {
  /** Stable plugin identifier used by install requests. */
  pluginId: string
  /** Human-readable plugin title. */
  title: string
  /** Human-readable plugin description. */
  description: string
  /** Catalog version displayed with the plugin. */
  version: string
  /** System entries are enabled in every composition and cannot be removed. */
  systemDefault: boolean
  /** Server-owned activator key; absent only for capabilities already in the base composition. */
  activationId?: string
}

/** Catalog entry projected with this account's installation state. */
export interface AccountPluginView extends Omit<PluginCatalogEntry, 'activationId'> { installed: boolean }
