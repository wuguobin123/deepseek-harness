/**
 * In-app directory picker (browse mode).
 *
 * Re-implements webUI's `<DirectoryPickerBrowse>` — a recursive
 * directory tree rendered inside the desktop window. Used when the
 * shell hasn't been granted filesystem access (sandbox mode) and the
 * host exposes a `directory.list` API for the current workspace.
 */
import React from 'react'

export interface DirectoryEntry {
  name: string
  path: string
  kind: 'dir' | 'file'
  children?: DirectoryEntry[]
}

export interface DirectoryPickerBrowseProps {
  root: DirectoryEntry | null
  onPick: (path: string) => void
  onCancel: () => void
}

export function DirectoryPickerBrowse({ root, onPick, onCancel }: DirectoryPickerBrowseProps): React.JSX.Element | null {
  if (!root) return null
  return (
    <section className="directory-picker directory-picker--browse" data-testid="directory-picker-browse">
      <header className="directory-picker__header">
        <h2 className="directory-picker__title">浏览目录</h2>
        <button type="button" className="ghost" data-testid="directory-picker-cancel" onClick={onCancel}>
          取消
        </button>
      </header>
      <DirectoryNode entry={root} onPick={onPick} depth={0} />
    </section>
  )
}

function DirectoryNode({
  entry,
  onPick,
  depth,
}: { entry: DirectoryEntry; onPick: (path: string) => void; depth: number }): React.JSX.Element {
  const [open, setOpen] = React.useState(depth < 2)
  if (entry.kind === 'file') {
    return (
      <button
        type="button"
        className="directory-picker__file"
        data-testid="directory-picker-file"
        data-path={entry.path}
        onClick={() =>{  onPick(entry.path) }}
      >
        {entry.name}
      </button>
    )
  }
  return (
    <details
      className="directory-picker__dir"
      data-testid="directory-picker-dir"
      data-path={entry.path}
      open={open}
      onToggle={(e) =>{  setOpen((e.target as HTMLDetailsElement).open) }}
    >
      <summary
        className="directory-picker__dir-summary"
        data-testid="directory-picker-dir-summary"
        onClick={(e) => { e.preventDefault(); setOpen(v => !v) }}
      >
        {entry.name}
      </summary>
      {open ? (
        <ul className="directory-picker__children">
          {(entry.children ?? []).map(child => (
            <li key={child.path}>
              <DirectoryNode entry={child} onPick={onPick} depth={depth + 1} />
            </li>
          ))}
        </ul>
      ) : null}
    </details>
  )
}
