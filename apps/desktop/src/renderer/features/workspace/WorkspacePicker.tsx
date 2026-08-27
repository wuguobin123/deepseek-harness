/**
 * Workspace picker (hero seat).
 *
 * Re-implements webUI's `<WorkspacePicker>` occupant of
 * `conversation.hero.workspace`. Renders a dropdown of available
 * workspaces; selecting one calls `ctx.workspaces.select(id)`.
 *
 * Driven by the workspace snapshot read from
 * `ctx.workspaces.list({})`. Each workspace row shows the title (resolved
 * via `workspaceTitleOf`) and its current selection state.
 */
import React from 'react'

export interface WorkspacePickerProps {
  workspaces: Array<{ id: string; title: string; selected?: boolean }>
  onSelect: (workspaceId: string) => void
  onCreate: () => void
}

export function WorkspacePicker({ workspaces, onSelect, onCreate }: WorkspacePickerProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false)
  const selected = workspaces.find(w => w.selected) ?? workspaces[0]

  return (
    <div className="workspace-picker" data-testid="workspace-picker">
      <button
        type="button"
        className="workspace-picker__trigger"
        data-testid="workspace-picker-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() =>{  setOpen(v => !v) }}
      >
        <span className="workspace-picker__label">{selected.title}</span>
        <span className="workspace-picker__chevron" aria-hidden="true">▾</span>
      </button>
      {open ? (
        <ul className="workspace-picker__menu" role="listbox" data-testid="workspace-picker-menu">
          {workspaces.map(w => (
            <li key={w.id} role="option" aria-selected={w.selected}>
              <button
                type="button"
                className={`workspace-picker__option ${w.selected ? 'is-selected' : ''}`}
                data-testid="workspace-picker-option"
                data-workspace-id={w.id}
                onClick={() => { onSelect(w.id); setOpen(false) }}
              >
                {w.title}
              </button>
            </li>
          ))}
          <li className="workspace-picker__menu-divider" role="separator" />
          <li>
            <button
              type="button"
              className="workspace-picker__create"
              data-testid="workspace-picker-create"
              onClick={() => { setOpen(false); onCreate() }}
            >
              + 新建工作区
            </button>
          </li>
        </ul>
      ) : null}
    </div>
  )
}
