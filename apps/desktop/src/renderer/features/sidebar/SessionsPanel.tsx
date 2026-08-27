/**
 * Sessions panel — sidebar rail.
 *
 * Re-implements webUI's `<SessionsPanel>` occupant of
 * `sidebar.section.sessions`. Lists live sessions from
 * `ctx.sessions.list()` and dispatches select/create/delete through
 * the same store.
 */

export interface SessionListEntry {
  id: string
  title: string
  updatedAt: number
  isActive: boolean
  unread?: boolean
}

export interface SessionsPanelProps {
  sessions: SessionListEntry[]
  onPick: (id: string) => void
  onCreate: () => void
  onArchive: (id: string) => void
}

export function SessionsPanel({ sessions, onPick, onCreate, onArchive }: SessionsPanelProps): React.JSX.Element {
  return (
    <section className="sidebar__panel sidebar__panel--sessions" data-testid="sidebar-sessions">
      <header className="sidebar__panel-header">
        <h3 className="sidebar__panel-title">会话</h3>
        <button
          type="button"
          className="ghost"
          onClick={onCreate}
          data-testid="sidebar-session-create"
          aria-label="新增会话"
        >
          +
        </button>
      </header>
      <ul className="sidebar__list" data-testid="sidebar-sessions-list">
        {sessions.map(s => (
          <li
            key={s.id}
            className={`sidebar__item ${s.isActive ? 'is-active' : ''}`}
            data-testid="sidebar-session-item"
            data-session-id={s.id}
            data-active={s.isActive}
          >
            <button
              type="button"
              className="sidebar__item-main"
              data-testid="sidebar-session-pick"
              onClick={() =>{  onPick(s.id) }}
            >
              <span className="sidebar__item-label">{s.title}</span>
              {s.unread ? <span className="sidebar__item-unread" aria-hidden="true">●</span> : null}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() =>{  onArchive(s.id) }}
              data-testid="sidebar-session-archive"
              aria-label="归档"
            >
              ⌫
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
