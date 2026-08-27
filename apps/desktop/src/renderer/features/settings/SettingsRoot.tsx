/**
 * Settings root.
 *
 * Re-implements webUI's `<SettingsRoot>` occupant of `settings`. The
 * page renders the section list and the active section. Replaces the
 * legacy `SettingsPage`.
 */
import React from 'react'

export interface SettingsSectionMeta {
  id: string
  title: string
  description?: string
  icon?: string
}

export interface SettingsRootProps {
  sections: SettingsSectionMeta[]
  activeSectionId: string
  onSelectSection: (id: string) => void
  renderActiveSection: (id: string) => React.ReactNode
}

export function SettingsRoot({ sections, activeSectionId, onSelectSection, renderActiveSection }: SettingsRootProps): React.JSX.Element {
  return (
    <section className="settings-root" data-testid="settings-root">
      <aside className="settings-root__nav" aria-label="设置分类">
        <h1 className="settings-root__title">设置</h1>
        <ul className="settings-root__nav-list" data-testid="settings-nav-list">
          {sections.map(s => (
            <li key={s.id}>
              <button
                type="button"
                className={`settings-root__nav-item ${s.id === activeSectionId ? 'is-active' : ''}`}
                data-testid="settings-nav-item"
                data-section-id={s.id}
                aria-current={s.id === activeSectionId ? 'page' : undefined}
                onClick={() =>{  onSelectSection(s.id) }}
              >
                <span className="settings-root__nav-icon" aria-hidden="true">{s.icon ?? '⚙'}</span>
                <span className="settings-root__nav-title">{s.title}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <main className="settings-root__content" data-testid="settings-section">
        {renderActiveSection(activeSectionId)}
      </main>
    </section>
  )
}
