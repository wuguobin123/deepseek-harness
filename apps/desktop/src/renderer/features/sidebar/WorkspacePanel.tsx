/**
 * Workspace panel — sidebar rail.
 *
 * Re-implements webUI's `<WorkspacePanel>` occupant of
 * `sidebar.section.workspace`. Lists workspaces from
 * `ctx.workspaces.list()` and supports pick/create via the directory
 * picker slots.
 */

export interface WorkspaceListEntry {
  id: string
  label: string
  path: string
  isActive: boolean
  pinned?: boolean
}

export interface WorkspacePanelProps {
  workspaces: WorkspaceListEntry[]
  onPick: (id: string) => void
  onCreate: () => void
  onTogglePin: (id: string) => void
  onRemove: (id: string) => void
}

export function WorkspacePanel({ workspaces, onPick, onCreate, onTogglePin, onRemove }: WorkspacePanelProps): React.JSX.Element {
  return (
    <section className="sidebar__panel sidebar__panel--workspace" data-testid="sidebar-workspace">
      <header className="sidebar__panel-header">
        <h3 className="sidebar__panel-title">工作区</h3>
        <button
          type="button"
          className="ghost"
          onClick={onCreate}
          data-testid="sidebar-workspace-create"
          aria-label="新增工作区"
        >
          +
        </button>
      </header>
      <ul className="sidebar__list" data-testid="sidebar-workspace-list">
        {workspaces.map(w => (
          <li
            key={w.id}
            className={`sidebar__item ${w.isActive ? 'is-active' : ''}`}
            data-testid="sidebar-workspace-item"
            data-workspace-id={w.id}
            data-active={w.isActive}
          >
            <button
              type="button"
              className="sidebar__item-main"
              data-testid="sidebar-workspace-pick"
              onClick={() =>{  onPick(w.id) }}
              title={w.path}
            >
              <span className="sidebar__item-label">{w.label}</span>
              {w.pinned ? <span className="sidebar__item-pin" aria-hidden="true">📌</span> : null}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() =>{  onTogglePin(w.id) }}
              data-testid="sidebar-workspace-pin"
              aria-label={w.pinned ? '取消置顶' : '置顶'}
            >
              {w.pinned ? '★' : '☆'}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() =>{  onRemove(w.id) }}
              data-testid="sidebar-workspace-remove"
              aria-label="移除"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
