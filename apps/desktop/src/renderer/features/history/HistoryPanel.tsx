/**
 * History panel.
 *
 * Re-implements webUI's `<HistoryList>` and replaces the legacy
 * `HistoryPage`. Surfaces archived sessions from `ctx.sessions.archive()`,
 * supports search + restore. Restore dispatches through
 * `ctx.sessions.restore(sessionId)` which re-creates a live session
 * with the original events.
 */
import React from 'react'

export interface ArchivedSession {
  id: string
  title: string
  endedAt: number
  messageCount: number
  workspaceId: string | null
}

export interface HistoryPanelProps {
  sessions: ArchivedSession[]
  query: string
  onQueryChange: (q: string) => void
  onRestore: (id: string) => void
  onDelete: (id: string) => void
}

export function HistoryPanel({ sessions, query, onQueryChange, onRestore, onDelete }: HistoryPanelProps): React.JSX.Element {
  const filtered = React.useMemo(() => {
    if (!query.trim()) return sessions
    const needle = query.toLowerCase()
    return sessions.filter(s =>
      s.title.toLowerCase().includes(needle) || s.id.toLowerCase().includes(needle),
    )
  }, [query, sessions])

  return (
    <section className="history-panel" data-testid="history-panel">
      <header className="history-panel__header">
        <h2 className="history-panel__title">历史会话</h2>
        <input
          type="search"
          className="history-panel__search"
          value={query}
          onChange={(e) =>{  onQueryChange(e.target.value) }}
          placeholder="搜索会话…"
          data-testid="history-search"
        />
      </header>
      {filtered.length === 0 ? (
        <p className="history-panel__empty" data-testid="history-empty">没有匹配的会话</p>
      ) : (
        <ul className="history-panel__list" data-testid="history-list">
          {filtered.map(s => (
            <li
              key={s.id}
              className="history-panel__item"
              data-testid="history-item"
              data-session-id={s.id}
            >
              <div className="history-panel__item-main">
                <h3 className="history-panel__item-title">{s.title}</h3>
                <span className="history-panel__item-meta">
                  {new Date(s.endedAt).toLocaleString()} · {s.messageCount} 条消息
                </span>
              </div>
              <div className="history-panel__item-actions">
                <button
                  type="button"
                  className="primary"
                  data-testid="history-restore"
                  onClick={() =>{  onRestore(s.id) }}
                >
                  恢复
                </button>
                <button
                  type="button"
                  className="ghost"
                  data-testid="history-delete"
                  onClick={() =>{  onDelete(s.id) }}
                >
                  删除
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
