import React from 'react';
import { Link } from 'react-router-dom';
import type { Anomaly } from '../../../shared/contracts';
import {
  IconAlert,
  IconApproval,
  IconChevronRight,
  IconInbox
} from '../../components/icons';
import { workbenchApi } from '../../api';

interface ApprovalRow {
  approvalId: string;
  objectType: string;
  objectId: string;
  summary: string;
  riskLevel: string;
  status: string;
  requestedBy: string;
  createdAt: string;
}

export function ApprovalsPage(): JSX.Element {
  const [items, setItems] = React.useState<ApprovalRow[]>([]);
  const [anomalies, setAnomalies] = React.useState<Anomaly[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    void Promise.all([
      workbenchApi.request({ method: 'GET', path: '/api/approvals' }),
      workbenchApi.listAnomalies()
    ])
      .then(([response, anomalyResponse]) => {
        if (!active) return;
        if (response.status >= 400) throw new Error(`HTTP ${response.status}`);
        setItems(
          Array.isArray(response.body)
            ? (response.body as ApprovalRow[]).filter((item) =>
                ['pending', 'awaiting_approval'].includes(item.status)
              )
            : []
        );
        setAnomalies(
          anomalyResponse.items.filter(
            (item) => !['resolved', 'ignored'].includes(item.status)
          )
        );
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <section className="page page--approvals" data-testid="approvals-page">
      <header className="page__header">
        <div>
          <h2>待我处理</h2>
          <p>所有需要人工判断的审批与异常集中在这里。</p>
        </div>
        {!loading ? (
          <span className="attention-count">{items.length + anomalies.length} 项待处理</span>
        ) : null}
      </header>
      {loading ? <p className="status-line"><span className="spinner" />正在汇总待办…</p> : null}
      {error ? <p className="err">加载失败：{error}</p> : null}
      {!loading && !error && items.length === 0 && anomalies.length === 0 ? (
        <div className="empty">
          <IconInbox size={30} />
          <p className="empty__title">当前没有需要你处理的事项</p>
          <p>需要授权或人工判断的任务会自动汇总到这里。</p>
        </div>
      ) : null}
      {items.length > 0 ? (
        <section className="attention-section">
          <header>
            <IconApproval size={16} />
            <div>
              <h3>待审批</h3>
              <p>确认后才会发生外部写操作。</p>
            </div>
          </header>
          <div className="approval-list">
            {items.map((item) => (
              <article key={item.approvalId}>
                <IconApproval size={18} />
                <div>
                  <strong>{item.summary}</strong>
                  <p>{item.objectType} · {item.objectId} · 申请人 {item.requestedBy}</p>
                  <small>{new Date(item.createdAt).toLocaleString('zh-CN')}</small>
                </div>
                <span className={`badge badge--${item.status}`}>{item.status === 'pending' ? '待审批' : item.status}</span>
                <Link className="btn btn--ghost btn--sm" to={item.objectType === 'command' ? '/tasks' : '/'}>
                  查看上下文
                </Link>
              </article>
            ))}
          </div>
        </section>
      ) : null}
      {anomalies.length > 0 ? (
        <section className="attention-section attention-section--anomalies">
          <header>
            <IconAlert size={16} />
            <div>
              <h3>执行异常</h3>
              <p>任务仍保留上下文，可修复后继续执行。</p>
            </div>
          </header>
          <div className="attention-list">
            {anomalies.map((anomaly) => (
              <Link
                to={`/anomalies/${encodeURIComponent(anomaly.anomalyId)}`}
                key={anomaly.anomalyId}
              >
                <IconAlert size={17} />
                <span>
                  <strong>{anomaly.title}</strong>
                  <small>
                    {anomaly.sourcePlugin} · 已出现 {anomaly.occurrenceCount} 次
                  </small>
                </span>
                <span className={`badge badge--${anomaly.severity}`}>
                  {anomaly.severity === 'critical'
                    ? '严重'
                    : anomaly.severity === 'high'
                      ? '高'
                      : anomaly.severity === 'medium'
                        ? '中'
                        : '低'}
                </span>
                <IconChevronRight size={14} />
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </section>
  );
}
