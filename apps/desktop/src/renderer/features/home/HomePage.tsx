/**
 * Home page.
 *
 * Lists existing sessions for the current workspace, surfaces a single
 * "New session" affordance, and lets the user jump straight into the
 * Assistant view. Errors surface inline; no global toast plumbing.
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import * as api from '../../api';

interface SessionItem {
  sessionId: string;
  title?: string;
  updatedAt?: string;
  blank?: boolean;
}

function formatTime(value: string | undefined): string {
  if (!value) return '';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export function HomePage(): JSX.Element {
  const navigate = useNavigate();
  const [sessions, setSessions] = React.useState<SessionItem[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);

  const refresh = React.useCallback(async () => {
    try {
      const list = await api.session.list({});
      setSessions(list);
      setError(null);
    } catch (err) {
      setSessions([]);
      setError((err as Error).message);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const onCreate = React.useCallback(async () => {
    setCreating(true);
    try {
      const created = await api.session.create({});
      navigate(`/assistant/${created.sessionId}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }, [navigate]);

  return (
    <section className="page page-home" data-testid="page-home">
      <header className="page-home__header">
        <h1>会话</h1>
        <button
          type="button"
          className="primary"
          onClick={onCreate}
          disabled={creating}
          data-testid="home-new-session"
        >
          {creating ? '正在创建…' : '新建会话'}
        </button>
      </header>
      {error ? (
        <p className="page-home__error" role="alert" data-testid="home-error">
          {error}
        </p>
      ) : null}
      {sessions === null ? (
        <p className="page-home__empty" data-testid="home-loading">
          正在加载会话…
        </p>
      ) : sessions.length === 0 ? (
        <p className="page-home__empty" data-testid="home-empty">
          还没有会话，点击右上角「新建会话」开始一次对话。
        </p>
      ) : (
        <ul className="session-list" data-testid="home-session-list">
          {sessions.map((s) => (
            <li key={s.sessionId} className="session-list__item">
              <button
                type="button"
                className="session-list__row"
                onClick={() => navigate(`/assistant/${s.sessionId}`)}
                data-testid="home-session-row"
                data-session-id={s.sessionId}
              >
                <strong>{s.title?.trim() || (s.blank ? '空会话' : '会话')}</strong>
                <small>{formatTime(s.updatedAt)}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}