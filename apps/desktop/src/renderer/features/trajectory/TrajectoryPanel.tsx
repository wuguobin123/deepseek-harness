/**
 * Trajectory panel — event timeline for the active session.
 *
 * Re-implements webUI's `<TrajectoryPanel>` detail-panel occupant.
 * Lists every envelope the runtime received in chronological order;
 * click expands the envelope's typed payload.
 */
import React from 'react'

export interface TrajectoryEntry {
  id: string
  timestamp: number
  kind: string
  summary: string
  payload: unknown
}

export interface TrajectoryPanelProps {
  entries: TrajectoryEntry[]
  onJumpTo?: (entry: TrajectoryEntry) => void
}

export function TrajectoryPanel({ entries, onJumpTo }: TrajectoryPanelProps): React.JSX.Element {
  return (
    <section className="trajectory-panel" data-testid="trajectory-panel">
      <header className="trajectory-panel__header">
        <h2 className="trajectory-panel__title">轨迹</h2>
        <span className="trajectory-panel__count">{entries.length} 条事件</span>
      </header>
      <ol className="trajectory-panel__list" data-testid="trajectory-list">
        {entries.map(e => (
          <TrajectoryItem key={e.id} entry={e} onJumpTo={onJumpTo} />
        ))}
      </ol>
    </section>
  )
}

function TrajectoryItem({ entry, onJumpTo }: { entry: TrajectoryEntry; onJumpTo?: (e: TrajectoryEntry) => void }): React.JSX.Element {
  const [open, setOpen] = React.useState(false)
  return (
    <li
      className={`trajectory-panel__item trajectory-panel__item--${entry.kind}`}
      data-testid="trajectory-item"
      data-entry-id={entry.id}
      data-kind={entry.kind}
    >
      <button
        type="button"
        className="trajectory-panel__summary"
        data-testid="trajectory-summary"
        aria-expanded={open}
        onClick={() =>{  setOpen(v => !v) }}
      >
        <span className="trajectory-panel__time">{formatTime(entry.timestamp)}</span>
        <span className="trajectory-panel__kind">{entry.kind}</span>
        <span className="trajectory-panel__text">{entry.summary}</span>
        {onJumpTo ? (
          <button
            type="button"
            className="trajectory-panel__jump"
            data-testid="trajectory-jump"
            onClick={(ev) => { ev.stopPropagation(); onJumpTo(entry) }}
          >
            跳转
          </button>
        ) : null}
      </button>
      {open ? (
        <pre className="trajectory-panel__payload" data-testid="trajectory-payload">{formatJson(entry.payload)}</pre>
      ) : null}
    </li>
  )
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString('zh-CN', { hour12: false })
}

function formatJson(value: unknown): string {
  try { return JSON.stringify(value, null, 2) } catch { return String(value) }
}
