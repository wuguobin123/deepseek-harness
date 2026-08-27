/**
 * Skills panel — sidebar rail.
 *
 * Re-implements webUI's `<SkillsPanel>` occupant of
 * `sidebar.section.skills`. Lists registered skills from
 * `ctx.skills.list()` and exposes toggle / open-detail.
 */

export interface SkillRow {
  id: string
  name: string
  description?: string
  enabled: boolean
}

export interface SkillsPanelProps {
  skills: SkillRow[]
  onToggle: (id: string) => void
  onOpen: (id: string) => void
}

export function SkillsPanel({ skills, onToggle, onOpen }: SkillsPanelProps): React.JSX.Element {
  return (
    <section className="sidebar__panel sidebar__panel--skills" data-testid="sidebar-skills">
      <header className="sidebar__panel-header">
        <h3 className="sidebar__panel-title">技能</h3>
      </header>
      <ul className="sidebar__list" data-testid="sidebar-skills-list">
        {skills.map(s => (
          <li
            key={s.id}
            className={`sidebar__item ${s.enabled ? 'is-active' : ''}`}
            data-testid="sidebar-skill-item"
            data-skill-id={s.id}
            data-enabled={s.enabled}
          >
            <button
              type="button"
              className="sidebar__item-main"
              data-testid="sidebar-skill-open"
              onClick={() =>{  onOpen(s.id) }}
            >
              <span className="sidebar__item-label">{s.name}</span>
            </button>
            <button
              type="button"
              className="ghost"
              data-testid="sidebar-skill-toggle"
              onClick={() =>{  onToggle(s.id) }}
              aria-label={s.enabled ? '禁用' : '启用'}
            >
              {s.enabled ? '●' : '○'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
