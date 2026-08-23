import React from 'react';
import { Link } from 'react-router-dom';
import { useTriggersStore } from '../../stores/triggers';
import { IconBolt, IconChevronRight, IconInbox } from '../../components/icons';
import { triggerStatusLabel, triggerTypeLabel } from '../../i18n';

export function AutomationsPage(): JSX.Element {
  const { items, loading, error, load } = useTriggersStore();

  React.useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="page page--automations" data-testid="automations-page">
      <header className="page__header">
        <div>
          <h2>自动化任务</h2>
          <p>让已经验证过的 AI 任务按时间、事件或业务条件持续运行。</p>
        </div>
        <Link className="btn btn--primary" to="/triggers">新建自动化</Link>
      </header>
      {loading ? <p className="status-line"><span className="spinner" />正在加载自动化…</p> : null}
      {error ? <p className="err">加载失败：{error}</p> : null}
      {!loading && !error && items.length === 0 ? (
        <div className="empty">
          <IconInbox size={30} />
          <p className="empty__title">还没有自动化任务</p>
          <p>先让 AI 完成一次任务，再从结果中选择“保存为自动化”。</p>
        </div>
      ) : null}
      <div className="automation-list">
        {items.map((item) => (
          <article key={item.triggerId}>
            <IconBolt size={18} />
            <div>
              <strong>{String(item.arguments?.title ?? item.capabilityId)}</strong>
              <p>{triggerTypeLabel(item.type)} · {item.capabilityId}</p>
              <small>
                {item.nextFireAt
                  ? `下次运行 ${new Date(item.nextFireAt).toLocaleString('zh-CN')}`
                  : '尚未安排下一次运行'}
              </small>
            </div>
            <span className={`badge badge--${item.status}`}>{triggerStatusLabel(item.status)}</span>
            <Link className="btn btn--ghost btn--sm" to="/triggers">
              管理规则 <IconChevronRight size={12} />
            </Link>
          </article>
        ))}
      </div>
    </section>
  );
}
