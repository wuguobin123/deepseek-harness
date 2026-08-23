import { Link } from 'react-router-dom';
import type { Anomaly } from '../../shared/contracts';
import {
  ANOMALY_STATUS_LABELS,
  SEVERITY_LABELS,
  anomalyStatusLabel,
  severityLabel,
  t
} from '../i18n';

interface Props {
  anomaly: Anomaly;
}

export function AnomalyCard({ anomaly }: Props): JSX.Element {
  return (
    <article className={`card card--${anomaly.severity}`} data-testid={`anomaly-card-${anomaly.anomalyId}`}>
      <header className="card__header">
        <h3>
          <Link
            to={`/anomalies/${anomaly.anomalyId}`}
            data-testid={`anomaly-link-${anomaly.anomalyId}`}
            title={t('anomalies.card.openDetail')}
          >
            {anomaly.title || t('common.untitled')}
          </Link>
        </h3>
        <div className="badges">
          <span
            className={`badge badge--${anomaly.severity}`}
            data-testid="card-severity"
            title={SEVERITY_LABELS[anomaly.severity] ?? anomaly.severity}
          >
            {severityLabel(anomaly.severity)}
          </span>
          <span
            className={`badge badge--${anomaly.status}`}
            data-testid="card-status"
            title={ANOMALY_STATUS_LABELS[anomaly.status] ?? anomaly.status}
          >
            {anomalyStatusLabel(anomaly.status)}
          </span>
        </div>
      </header>
      <p className="card__desc">{anomaly.description}</p>
      <footer className="card__footer">
        <span>
          <code>
            {anomaly.sourcePlugin} / {anomaly.sourceCapability}
          </code>{' '}
          · {t('anomalies.card.occurrences', { count: anomaly.occurrenceCount })}
        </span>
        <time dateTime={anomaly.lastSeenAt}>
          {t('anomalies.card.lastSeen', {
            time: new Date(anomaly.lastSeenAt).toLocaleString('zh-CN')
          })}
        </time>
      </footer>
    </article>
  );
}
