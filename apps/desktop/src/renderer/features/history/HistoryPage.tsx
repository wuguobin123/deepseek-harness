/**
 * History page — search past sessions.
 *
 * Delegates to `api.session.search` (the dsh query surface backed by the
 * configured session-search provider). Results render as a flat list; each
 * row opens the session in the Assistant view.
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import * as api from '../../api';

interface SearchHit {
  sessionId: string;
  title?: string;
  updatedAt?: string;
  snippet?: string;
}

function formatTime(value: string | undefined): string {
  if (!value) return '';
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return new Date(parsed).toLocaleString();
}

export function HistoryPage(): JSX.Element {
  const navigate = useNavigate();
  const [query, setQuery] = React.useState('');
  const [hits, setHits] = React.useState<SearchHit[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [searched, setSearched] = React.useState(false);
  const [limit, setLimit] = React.useState(20);

  const onSearch = React.useCallback(
    async (event?: React.FormEvent<HTMLFormElement>): Promise<void> => {
      event?.preventDefault();
      const trimmed = query.trim();
      if (!trimmed) {
        setHits([]);
        setSearched(false);
        setError(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const result = await api.session.search({ query: trimmed, limit });
        setHits(result);
        setSearched(true);
      } catch (err) {
        setError((err as Error).message);
        setHits([]);
        setSearched(true);
      } finally {
        setLoading(false);
      }
    },
    [limit, query]
  );

  React.useEffect(() => {
    if (searched) return;
    void onSearch();
    // load an empty-string search once on mount so the page is not empty
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="page page-history" data-testid="page-history">
      <header className="page-history__header">
        <h1>历史会话</h1>
        <p className="muted">基于 dsh 搜索提供方，跨工作区查找过去的会话。</p>
      </header>
      <form className="page-history__form" onSubmit={onSearch} data-testid="history-form">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="输入关键字，例如 'deploy' 或 'oncall'"
          disabled={loading}
          data-testid="history-query"
        />
        <select
          value={String(limit)}
          onChange={(e) => setLimit(Number(e.target.value))}
          disabled={loading}
          data-testid="history-limit"
        >
          {[10, 20, 50, 100].map((n) => (
            <option key={n} value={String(n)}>
              {n} 条
            </option>
          ))}
        </select>
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
          {hits.map((hit) => (
            <li key={hit.sessionId} className="history-list__item">
              <button
                type="button"
                className="history-list__row"
                onClick={() => navigate(`/assistant/${hit.sessionId}`)}
                data-testid={`history-row-${hit.sessionId}`}
              >
                <strong>{hit.title?.trim() || `会话 ${hit.sessionId.slice(0, 8)}`}</strong>
                <small>{hit.sessionId}</small>
                {hit.snippet ? <p className="history-list__snippet">{hit.snippet}</p> : null}
                {hit.updatedAt ? <small className="history-list__time">{formatTime(hit.updatedAt)}</small> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}