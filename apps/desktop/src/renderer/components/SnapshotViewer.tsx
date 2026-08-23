import type { AnomalyDetail } from '../../shared/contracts';
import { t } from '../i18n';

interface Props {
  snapshot: AnomalyDetail['snapshot'];
}

export function SnapshotViewer({ snapshot }: Props): JSX.Element {
  if (!snapshot) {
    return (
      <div className="snapshot snapshot--empty muted" data-testid="snapshot-empty">
        {t('anomalies.detail.snapshot.empty')}
      </div>
    );
  }
  return (
    <section className="snapshot" data-testid="snapshot">
      <header>
        <strong>{t('anomalies.detail.snapshot')}</strong>
        <small>
          {t('anomalies.detail.snapshot.capturedAt')}{' '}
          {new Date(snapshot.capturedAt).toLocaleString('zh-CN')} · schema v{snapshot.schemaVersion}
        </small>
      </header>
      <pre>{JSON.stringify(snapshot.fields, null, 2)}</pre>
    </section>
  );
}
