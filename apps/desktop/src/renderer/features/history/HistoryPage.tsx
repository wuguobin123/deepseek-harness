import React from 'react';
import { IconInbox } from '../../components/icons';
import { firingStatusLabel, t } from '../../i18n';

interface HistoryFiring {
  firingId: string;
  triggerId: string;
  commandId: string | null;
  status: string;
  scheduledFor: string | null;
  createdAt: string;
}

export function HistoryPage(): JSX.Element {
  const [entries, setEntries] = React.useState<HistoryFiring[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    void window.workbenchApi
      .request({ method: 'GET', path: '/api/history' })
      .then((res) => {
        if (cancelled) return;
        if (res.status >= 400) {
          setError(t('history.error.load'));
          return;
        }
        const body = res.body as { firings?: HistoryFiring[] };
        setEntries(body?.firings ?? []);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="page page--history" data-testid="history-page">
      <header className="page__header">
        <div>
          <h2>{t('history.title')}</h2>
          <p className="muted">{t('history.subtitle')}</p>
        </div>
      </header>
      {error && (
        <p className="err" data-testid="history-error">
          {t('history.error.load')}（{error}）
        </p>
      )}
      {loading && <p className="status-line" data-testid="history-loading"><span className="spinner" />{t('history.loading')}</p>}
      {!loading && !error && entries.length === 0 && (
        <div className="empty" data-testid="history-empty">
          <IconInbox size={30} />
          <p className="empty__title">{t('history.empty')}</p>
        </div>
      )}
      {entries.length > 0 && (
        <div className="table-wrap">
        <table className="table" data-testid="history-table">
          <thead>
            <tr>
              <th>触发器</th>
              <th>计划时间</th>
              <th>命令</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, idx) => (
              <tr key={idx}>
                <td><code>{e.triggerId || t('common.untitled')}</code></td>
                <td>{e.scheduledFor ? new Date(e.scheduledFor).toLocaleString('zh-CN') : '—'}</td>
                <td><code>{e.commandId ?? '—'}</code></td>
                <td>
                  <span className={`badge badge--${e.status}`}>
                    {firingStatusLabel(e.status)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </section>
  );
}
