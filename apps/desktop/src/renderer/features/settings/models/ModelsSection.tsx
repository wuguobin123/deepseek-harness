/**
 * Settings → Models section.
 *
 * Re-implements webUI's `<ModelsSection>` registrant of
 * `settings.section` (id `models`) and `settings.models.item`.
 * Lists model providers / discovered models from
 * `ctx.modelCatalog.list()`. Editing fields posts through
 * `ctx.settingsScope.set('models.<providerId>', value)`.
 */

export interface ModelRow {
  id: string
  provider: string
  displayName: string
  contextWindow: number
  enabled: boolean
  apiKeyConfigured: boolean
}

export interface ModelsSectionProps {
  models: ModelRow[]
  onToggle: (id: string, enabled: boolean) => void
  onConfigureKey: (providerId: string) => void
}

export function ModelsSection({ models, onToggle, onConfigureKey }: ModelsSectionProps): React.JSX.Element {
  return (
    <section className="settings-section settings-section--models" data-testid="settings-models">
      <header className="settings-section__header">
        <h2 className="settings-section__title">模型</h2>
        <p className="settings-section__hint">启用 / 禁用各模型提供方；点击提供方名称配置 API 密钥。</p>
      </header>
      <ul className="settings-section__list" data-testid="settings-models-list">
        {models.map(m => (
          <li
            key={m.id}
            className={`settings-section__item ${m.enabled ? 'is-enabled' : 'is-disabled'}`}
            data-testid="settings-models-item"
            data-model-id={m.id}
            data-enabled={m.enabled}
          >
            <label className="settings-section__toggle">
              <input
                type="checkbox"
                checked={m.enabled}
                onChange={(e) =>{  onToggle(m.id, e.target.checked) }}
                data-testid="settings-models-toggle"
              />
              <span>{m.displayName}</span>
            </label>
            <span className="settings-section__meta">
              {m.contextWindow.toLocaleString()} tokens · {m.provider}
            </span>
            <button
              type="button"
              className="ghost"
              onClick={() =>{  onConfigureKey(m.provider) }}
              data-testid="settings-models-configure"
            >
              {m.apiKeyConfigured ? '更换密钥' : '配置密钥'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
