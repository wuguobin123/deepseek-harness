/**
 * Deliverables list — files / artifacts the assistant produced.
 *
 * Re-implements webUI's `<DeliverablesList>` occupant of
 * `conversation.session.header.utilities`. Each entry is a file the
 * host emitted as a "deliverable" (patch, generated artifact, etc.).
 * Click opens it via `ctx.remote.dispatch('file/open', { path })`.
 */

export interface DeliverableEntry {
  id: string
  path: string
  size?: number
  kind?: 'patch' | 'file' | 'note' | 'image'
  preview?: string
}

export interface DeliverablesListProps {
  entries: DeliverableEntry[]
  onOpen: (entry: DeliverableEntry) => void
  onDownload?: (entry: DeliverableEntry) => void
}

export function DeliverablesList({ entries, onOpen, onDownload }: DeliverablesListProps): React.JSX.Element | null {
  if (entries.length === 0) return null
  return (
    <ul className="deliverables-list" data-testid="deliverables-list">
      {entries.map(entry => (
        <li
          key={entry.id}
          className={`deliverables-list__item deliverables-list__item--${entry.kind ?? 'file'}`}
          data-testid="deliverables-list-item"
          data-deliverable-id={entry.id}
        >
          <button
            type="button"
            className="deliverables-list__open"
            data-testid="deliverables-list-open"
            onClick={() =>{  onOpen(entry) }}
          >
            <span className="deliverables-list__kind" aria-hidden="true">{iconFor(entry.kind)}</span>
            <span className="deliverables-list__path">{entry.path}</span>
            {entry.size !== undefined ? (
              <span className="deliverables-list__size">{formatSize(entry.size)}</span>
            ) : null}
          </button>
          {onDownload ? (
            <button
              type="button"
              className="deliverables-list__download"
              data-testid="deliverables-list-download"
              onClick={() =>{  onDownload(entry) }}
            >
              下载
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

function iconFor(kind: DeliverableEntry['kind']): string {
  switch (kind) {
    case 'patch': return 'Δ'
    case 'image': return '▣'
    case 'note':  return '✎'
    case 'file':
    default:      return '📄'
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}
