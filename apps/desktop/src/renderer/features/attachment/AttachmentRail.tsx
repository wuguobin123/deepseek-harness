/**
 * Composer attachment rail + drop overlay.
 *
 * Re-implements webUI's `<ComposerAttachments>` occupant of
 * `conversation.input.attachments` and the drag-overlay slot
 * `conversation.input.overlay`.
 *
 * Phase 1 left attachments as a no-op surface. This component adds:
 *   - chip list above the composer
 *   - drop overlay during file drag
 *   - context attachments registry read via `ctx.attachments.list()`
 */

export interface AttachmentEntry {
  id: string
  name: string
  mime: string
  size: number
  preview?: string
}

export interface AttachmentRailProps {
  attachments: AttachmentEntry[]
  onRemove: (id: string) => void
}

export function AttachmentRail({ attachments, onRemove }: AttachmentRailProps): React.JSX.Element | null {
  if (attachments.length === 0) return null
  return (
    <ul className="attachment-rail" data-testid="attachment-rail">
      {attachments.map(a => (
        <li key={a.id} className="attachment-chip" data-testid="attachment-chip" data-attachment-id={a.id}>
          <span className="attachment-chip__name">{a.name}</span>
          <span className="attachment-chip__size">{formatSize(a.size)}</span>
          <button
            type="button"
            className="attachment-chip__remove"
            data-testid="attachment-chip-remove"
            aria-label={`移除附件 ${a.name}`}
            onClick={() =>{  onRemove(a.id) }}
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  )
}

export function AttachmentDropOverlay({ active }: { active: boolean }): React.JSX.Element | null {
  if (!active) return null
  return (
    <div className="attachment-drop-overlay" data-testid="attachment-drop-overlay" role="status">
      <div className="attachment-drop-overlay__inner">
        <p className="attachment-drop-overlay__lead">拖放文件到此处附加</p>
      </div>
    </div>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}
