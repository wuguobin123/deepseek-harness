import React from 'react';
import { useAnomaliesStore } from '../../stores/anomalies';
import { AnomalyCard } from '../../components/AnomalyCard';
import { IconInbox, IconRefresh } from '../../components/icons';
import { workbenchApi } from '../../api';
import { ANOMALY_STATUS_LABELS, SEVERITY_LABELS, t } from '../../i18n';

export function AnomaliesPage(): JSX.Element {
  const { items, loading, error, filters, setFilter, load, applyEvent } = useAnomaliesStore();

  React.useEffect(() => {
    void load();
    let cancel = false;
    let unsubscribe: (() => void) | null = null;
    workbenchApi.subscribeAnomalies((event) => {
      if (!cancel) applyEvent(event);
    }).then((fn) => {
      if (cancel) fn();
      else unsubscribe = fn;
    }).catch(() => {
      /* stream not yet implemented on backend; fall back to polling */
    });
    return () => {
      cancel = true;
      if (unsubscribe) unsubscribe();
    };
  }, [load, applyEvent]);

  return (
    <section className="page page--anomalies" data-testid="anomalies-page">
      <header className="page__header">
        <div>
          <h2>{t('anomalies.title')}</h2>
          <p className="muted">{t('anomalies.subtitle')}</p>
        </div>
        <div className="filters">
          <label>
            {t('anomalies.filter.status')}
            <select
              value={filters.status}
              onChange={(e) => setFilter('status', e.target.value)}
              data-testid="filter-status"
            >
              <option value="">{t('anomalies.filter.all')}</option>
              {Object.entries(ANOMALY_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label>
            {t('anomalies.filter.severity')}
            <select
              value={filters.severity}
              onChange={(e) => setFilter('severity', e.target.value)}
              data-testid="filter-severity"
            >
              <option value="">{t('anomalies.filter.all')}</option>
              {Object.entries(SEVERITY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label>
            {t('anomalies.filter.owner')}
            <input
              type="search"
              value={filters.owner}
              onChange={(e) => setFilter('owner', e.target.value)}
              data-testid="filter-owner"
              placeholder="操作人 ID"
            />
          </label>
          <button
            type="button"
            className="btn"
            onClick={() => load()}
            disabled={loading}
            data-testid="refresh-anomalies"
            title={t('tooltip.refresh')}
          >
            <IconRefresh size={14} className={loading ? 'icon icon--spin' : 'icon'} />
            {t('common.refresh')}
          </button>
        </div>
      </header>

      {error && (
        <p className="err" data-testid="anomalies-error">
          {t('anomalies.error.load')}（{error}）
        </p>
      )}

      {loading && items.length === 0 ? (
        <div className="card-list" data-testid="anomalies-loading" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div className="skeleton-card" key={i}>
              <div className="skeleton-line" style={{ width: '38%' }} />
              <div className="skeleton-line" style={{ width: '72%' }} />
              <div className="skeleton-line" style={{ width: '55%' }} />
            </div>
          ))}
        </div>
      ) : (
        <>
          <p className="count" data-testid="anomalies-count">
            {t('anomalies.count_other', { count: items.length })}
          </p>
          <ul className="card-list" data-testid="anomaly-list">
            {items.map((a) => (
              <li key={a.anomalyId}>
                <AnomalyCard anomaly={a} />
              </li>
            ))}
          </ul>
          {!loading && items.length === 0 && (
            <div className="empty" data-testid="anomalies-empty">
              <IconInbox size={30} />
              <p className="empty__title">{t('anomalies.empty')}</p>
              <p>调整筛选条件，或点击右上角刷新重新加载。</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
