/**
 * Settings → Plugins section.
 *
 * Re-implements webUI's `<PluginsSection>` and
 * `<SettingsPluginInventorySection>`. Two tabs:
 *   - Inventory: installed plugins (per `ctx.modules.listInstalled()`)
 *   - Marketplace: available plugins (per `ctx.modules.listAvailable()`)
 *
 * Each row exposes enable/disable + open detail. The detail panel
 * (rendered as a child row) shows plugin permissions and version.
 */

export interface PluginRow {
  id: string
  name: string
  description?: string
  version: string
  enabled: boolean
  installed?: boolean
  permissions?: string[]
}

export interface PluginsSectionProps {
  plugins: PluginRow[]
  tab: 'inventory' | 'marketplace'
  onSwitchTab: (tab: 'inventory' | 'marketplace') => void
  onToggle: (id: string, enabled: boolean) => void
  onInstall: (id: string) => void
  onUninstall: (id: string) => void
}

export function PluginsSection({ plugins, tab, onSwitchTab, onToggle, onInstall, onUninstall }: PluginsSectionProps): React.JSX.Element {
  const filtered = plugins.filter(p => (tab === 'inventory' ? p.installed : !p.installed))
  return (
    <section className="settings-section settings-section--plugins" data-testid="settings-plugins">
      <header className="settings-section__header">
        <h2 className="settings-section__title">插件</h2>
      </header>
      <nav className="settings-section__tabs" data-testid="settings-plugins-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'inventory'}
          className={`settings-section__tab ${tab === 'inventory' ? 'is-active' : ''}`}
          data-testid="settings-plugins-tab-inventory"
          onClick={() =>{  onSwitchTab('inventory') }}
        >
          已安装 ({plugins.filter(p => p.installed).length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'marketplace'}
          className={`settings-section__tab ${tab === 'marketplace' ? 'is-active' : ''}`}
          data-testid="settings-plugins-tab-marketplace"
          onClick={() =>{  onSwitchTab('marketplace') }}
        >
          市场 ({plugins.filter(p => !p.installed).length})
        </button>
      </nav>
      <ul className="settings-section__list" data-testid="settings-plugins-list">
        {filtered.map(p => (
          <li
            key={p.id}
            className={`settings-section__item ${p.enabled ? 'is-enabled' : 'is-disabled'}`}
            data-testid="settings-plugins-item"
            data-plugin-id={p.id}
            data-installed={p.installed}
          >
            <div className="settings-section__item-main">
              <h3 className="settings-section__item-title">{p.name}</h3>
              <span className="settings-section__item-version">v{p.version}</span>
            </div>
            {p.description ? <p className="settings-section__item-desc">{p.description}</p> : null}
            <div className="settings-section__item-actions">
              {p.installed ? (
                <>
                  <label className="settings-section__toggle">
                    <input
                      type="checkbox"
                      checked={p.enabled}
                      onChange={(e) =>{  onToggle(p.id, e.target.checked) }}
                      data-testid="settings-plugins-toggle"
                    />
                    <span>{p.enabled ? '已启用' : '已禁用'}</span>
                  </label>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() =>{  onUninstall(p.id) }}
                    data-testid="settings-plugins-uninstall"
                  >
                    卸载
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="primary"
                  onClick={() =>{  onInstall(p.id) }}
                  data-testid="settings-plugins-install"
                >
                  安装
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
