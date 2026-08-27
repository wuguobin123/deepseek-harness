/**
 * History page — search past sessions.
 *
 * Delegates to `api.session.search` (the dsh query surface backed by the
 * configured session-search provider). Each result row carries only the
 * `sessionId` and a pre-computed snippet — title/timestamp come from
 * `session.list` if the user opens the session.
 */
import React from 'react'
import { useNavigate } from 'react-router-dom'
import * as api from '../../api'

function HistoryPage(): React.JSX.Element {
  const navigate = useNavigate()
  const [query, setQuery] = React.useState('')
  const [hits, setHits] = React.useState<api.SessionSearchItem[]>([])
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [searched, setSearched] = React.useState(false)
  const [limit] = React.useState(20)

  const onSearch = React.useCallback(
    async (event?: React.FormEvent<HTMLFormElement>): Promise<void> => {
      event?.preventDefault()
      const trimmed = query.trim()
      if (!trimmed) {
        setHits([])
        setSearched(false)
        setError(null)
        return
      }
      setLoading(true)
      setError(null)
      try {
        const result = await api.session.search({ query: trimmed })
        // `limit` is reserved for a future cursor implementation; the server
        // applies its own cap (SESSION_SEARCH_RESULT_LIMIT = 20) and signals
        // overflow via `hasMore`.
        void limit
        setHits(result.items)
        setSearched(true)
      } catch (err) {
        setError((err as Error).message)
        setHits([])
        setSearched(true)
      } finally {
        setLoading(false)
      }
    },
    [limit, query],
  )

  React.useEffect(() => {
    if (searched) return
    void onSearch()
    // load an empty-string search once on mount so the page is not empty
  }, [])

  return (
    <section className="page page-history" data-testid="page-history">
      <header className="page-history__header">
        <h1>历史会话</h1>
        <p className="muted">基于 dsh 搜索提供方，跨工作区查找过去的会话。</p>
      </header>
      <form className="page-history__form" onSubmit={(event) => { void onSearch(event) }} data-testid="history-form">
        <input
          type="search"
          value={query}
          onChange={(e) =>{  setQuery(e.target.value) }}
          placeholder="输入关键字，例如 'deploy' 或 'oncall'"
          disabled={loading}
          data-testid="history-query"
        />
        <button type="submit" className="primary" disabled={loading || !query.trim()} data-testid="history-submit">
          {loading ? '搜索中…' : '搜索'}
        </button>
      </form>
      {error ? (
        <p className="page-history__error" role="alert" data-testid="history-error">
          {error}
        </p>
      ) : null}
      {!loading && searched && hits.length === 0 ? (
        <p className="page-history__empty" data-testid="history-empty">
          没有找到匹配的会话。
        </p>
      ) : null}
      {hits.length > 0 ? (
        <ul className="history-list" data-testid="history-list">
          {hits.map(hit => (
            <li key={hit.sessionId} className="history-list__item">
              <button
                type="button"
                className="history-list__row"
                onClick={() =>{  navigate(`/assistant/${hit.sessionId}`) }}
                data-testid={`history-row-${hit.sessionId}`}
              >
                <strong>{`会话 ${hit.sessionId.slice(0, 8)}`}</strong>
                <small>{hit.sessionId}</small>
                {hit.snippet ? <p className="history-list__snippet">{hit.snippet}</p> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

export { HistoryPage }
