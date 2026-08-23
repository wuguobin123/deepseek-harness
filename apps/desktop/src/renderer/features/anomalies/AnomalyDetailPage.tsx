import React from 'react';
import { Link, useParams } from 'react-router-dom';
import type { AnomalyDetail } from '../../../shared/contracts';
import { workbenchApi } from '../../api';
import { SnapshotViewer } from '../../components/SnapshotViewer';
import { ConversationThread, type ConversationMessage } from '../../components/ConversationThread';
import { VerificationButton } from '../../components/VerificationButton';
import { IconArrowLeft } from '../../components/icons';
import {
  ANOMALY_STATUS_LABELS,
  SEVERITY_LABELS,
  anomalyStatusLabel,
  severityLabel,
  t
} from '../../i18n';

export function AnomalyDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = React.useState<AnomalyDetail | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<ConversationMessage[]>([]);
  const [artifactId, setArtifactId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!id) return;
    let cancelled = false;
    workbenchApi.getAnomaly(id)
      .then((data) => {
        if (cancelled) return;
        setDetail(data);
        setArtifactId(
          data.verificationArtifactId ?? extractArtifactId(data)
        );
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function send(text: string): Promise<void> {
    if (!id) return;
    const userMsg: ConversationMessage = { role: 'user', content: text, createdAt: new Date().toISOString() };
    setMessages((m) => [...m, userMsg]);
    try {
      const res = await workbenchApi.request({
        method: 'POST',
        path: `/api/anomalies/${encodeURIComponent(id)}/conversation`,
        body: { message: text }
      });
      if (res.status >= 400) {
        setMessages((m) => [...m, { role: 'assistant', content: 'AI 助手暂不可用，请稍后重试。' }]);
      } else {
        const body = res.body as { message?: string };
        setMessages((m) => [
          ...m,
          { role: 'assistant', content: body?.message ?? t('common.unknown'), createdAt: new Date().toISOString() }
        ]);
      }
    } catch (err) {
      setMessages((m) => [...m, { role: 'assistant', content: (err as Error).message }]);
    }
  }

  if (!id) return <p className="err" data-testid="anomaly-missing">缺少异常 ID。</p>;
  if (error)
    return (
      <p className="err" data-testid="anomaly-error">
        {t('anomalies.error.load')}（{error}）
      </p>
    );
  if (!detail)
    return (
      <div className="page" data-testid="anomaly-loading">
        <div className="skeleton-card">
          <div className="skeleton-line" style={{ width: '42%' }} />
          <div className="skeleton-line" style={{ width: '70%' }} />
        </div>
        <div className="skeleton-card">
          <div className="skeleton-line" style={{ width: '30%' }} />
          <div className="skeleton-line" style={{ width: '85%' }} />
          <div className="skeleton-line" style={{ width: '60%' }} />
        </div>
      </div>
    );

  return (
    <section className="page page--anomaly-detail" data-testid="anomaly-detail-page">
      <Link to="/anomalies" className="back-link" data-testid="back-to-anomalies">
        <IconArrowLeft size={14} />
        {t('common.back')}
      </Link>
      <header className="page__header">
        <div>
          <h2>{detail.title || t('common.untitled')}</h2>
          <p className="muted">{detail.description}</p>
        </div>
        <div className="badges">
          <span
            className={`badge badge--${detail.severity}`}
            title={SEVERITY_LABELS[detail.severity] ?? detail.severity}
          >
            {severityLabel(detail.severity)}
          </span>
          <span
            className={`badge badge--${detail.status}`}
            title={ANOMALY_STATUS_LABELS[detail.status] ?? detail.status}
          >
            {anomalyStatusLabel(detail.status)}
          </span>
          <VerificationButton artifactId={artifactId} />
        </div>
      </header>

      <section className="panel occurrences" data-testid="occurrences">
        <h3>{t('anomalies.detail.timeline')}</h3>
        {detail.occurrences.length === 0 ? (
          <p className="muted">暂无发生记录。</p>
        ) : (
          <ol>
            {detail.occurrences.map((o) => (
              <li key={o.occurrenceId}>
                <time dateTime={o.occurredAt}>{new Date(o.occurredAt).toLocaleString('zh-CN')}</time>
                <span className="badge">{o.errorCode ?? '—'}</span>
                <span>{o.message}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <SnapshotViewer snapshot={detail.snapshot} />

      <ConversationThread
        conversationId={detail.conversationId}
        messages={messages}
        onSend={(text) => void send(text)}
      />

      <details className="panel details">
        <summary>追踪与诊断</summary>
        <pre>{JSON.stringify({ traceId: detail.traceId, anomaly: detail }, null, 2)}</pre>
      </details>
    </section>
  );
}

function extractArtifactId(detail: AnomalyDetail): string | null {
  if (!detail.deepLink) return null;
  try {
    const url = new URL(detail.deepLink);
    return url.searchParams.get('artifact_id');
  } catch {
    return null;
  }
}
