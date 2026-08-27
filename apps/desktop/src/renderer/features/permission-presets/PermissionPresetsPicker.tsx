/**
 * Permission presets picker.
 *
 * Re-implements webUI's `<PermissionPresetsPicker>` registrant of
 * `settings.permission.item`. Lists presets from
 * `ctx.permissionPresets.list()`; selecting one applies through
 * `ctx.permissionPresets.apply(presetId)`.
 */

export interface PermissionPreset {
  id: string
  name: string
  description?: string
  rules: Array<{ tool: string; decision: 'allow' | 'deny' | 'ask' }>
  selected?: boolean
}

export interface PermissionPresetsPickerProps {
  presets: PermissionPreset[]
  onApply: (id: string) => void
  onEditRule?: (presetId: string, ruleIndex: number) => void
}

export function PermissionPresetsPicker({ presets, onApply, onEditRule }: PermissionPresetsPickerProps): React.JSX.Element {
  return (
    <section className="permission-presets" data-testid="permission-presets">
      <header className="permission-presets__header">
        <h2 className="permission-presets__title">权限预设</h2>
        <p className="permission-presets__hint">选择工具调用的默认放行/拒绝/询问规则。</p>
      </header>
      <ul className="permission-presets__list" data-testid="permission-presets-list">
        {presets.map(p => (
          <li
            key={p.id}
            className={`permission-presets__item ${p.selected ? 'is-selected' : ''}`}
            data-testid="permission-presets-item"
            data-preset-id={p.id}
            data-selected={p.selected}
          >
            <div className="permission-presets__item-main">
              <h3 className="permission-presets__item-name">{p.name}</h3>
              {p.description ? <p className="permission-presets__item-desc">{p.description}</p> : null}
            </div>
            <ul className="permission-presets__rules">
              {p.rules.map((rule, i) => (
                <li
                  key={`${rule.tool}-${i}`}
                  className={`permission-presets__rule permission-presets__rule--${rule.decision}`}
                  data-testid="permission-presets-rule"
                  data-tool={rule.tool}
                  data-decision={rule.decision}
                >
                  <span className="permission-presets__rule-tool">{rule.tool}</span>
                  <span className="permission-presets__rule-decision">{rule.decision}</span>
                  {onEditRule ? (
                    <button
                      type="button"
                      className="ghost"
                      onClick={() =>{  onEditRule(p.id, i) }}
                      data-testid="permission-presets-edit"
                    >
                      编辑
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
            <button
              type="button"
              className={`primary ${p.selected ? 'is-active' : ''}`}
              onClick={() =>{  onApply(p.id) }}
              data-testid="permission-presets-apply"
            >
              {p.selected ? '已应用' : '应用'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
