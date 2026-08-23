import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTriggersStore } from '../../stores/triggers';
import type { TriggerFiring, TriggerType, TriggerUpsert } from '../../../shared/contracts';
import { IconRefresh } from '../../components/icons';
import { workbenchApi } from '../../api';
import {
  TRIGGER_STATUS_LABELS,
  t,
  triggerStatusLabel,
  triggerTypeLabel
} from '../../i18n';

const DEFAULT_FORM: TriggerUpsert = {
  pluginId: 'builtin',
  capabilityId: 'workbench.agent_prompt',
  type: 'cron',
  config: { cron: '0 9 * * *', timezone: 'Asia/Shanghai' },
  arguments: { prompt: '', title: '' },
  condition: null
};

type ScheduleMode = 'daily' | 'weekly' | 'monthly' | 'once';

export function TriggersPage(): JSX.Element {
  const [searchParams] = useSearchParams();
  const { items, loading, error, load, create, enable, disable } = useTriggersStore();
  const [draft, setDraft] = React.useState<TriggerUpsert>(DEFAULT_FORM);
  const [scheduleMode, setScheduleMode] = React.useState<ScheduleMode>('daily');
  const [scheduleTime, setScheduleTime] = React.useState('09:00');
  const [scheduleWeekday, setScheduleWeekday] = React.useState(1);
  const [scheduleDay, setScheduleDay] = React.useState(1);
  const [runAt, setRunAt] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [firings, setFirings] = React.useState<TriggerFiring[]>([]);

  const loadFirings = React.useCallback(async () => {
    try {
      setFirings(await workbenchApi.listTriggerFirings(20));
    } catch {
      setFirings([]);
    }
  }, []);

  React.useEffect(() => {
    void load();
    void loadFirings();
  }, [load, loadFirings]);

  React.useEffect(() => {
    const capabilityId = searchParams.get('capabilityId');
    if (!capabilityId) return;
    setDraft((item) => ({
      ...item,
      pluginId: item.pluginId || 'servicepilot.workbench',
      capabilityId
    }));
    setMessage(`已从任务 ${searchParams.get('commandId') ?? ''} 带入能力，请选择运行方式后保存。`);
  }, [searchParams]);

  async function handleCreate(): Promise<void> {
    setBusy(true);
    setMessage(null);
    let payload = draft;
    if (!advancedType) {
      const [hour, minute] = scheduleTime.split(':').map((v) => Number(v) || 0);
      if (scheduleMode === 'once') {
        payload = { ...draft, type: 'at', config: { at: new Date(runAt).toISOString() } };
      } else {
        const cron =
          scheduleMode === 'daily'
            ? `${minute} ${hour} * * *`
            : scheduleMode === 'weekly'
              ? `${minute} ${hour} * * ${scheduleWeekday}`
              : `${minute} ${hour} ${scheduleDay} * *`;
        payload = { ...draft, type: 'cron', config: { cron, timezone: 'Asia/Shanghai' } };
      }
    }
    const created = await create(payload);
    setBusy(false);
    if (created) {
      setMessage(`已创建 ${created.triggerId}`);
      setDraft(DEFAULT_FORM);
    }
  }

  const isAgentPrompt = draft.capabilityId === 'workbench.agent_prompt';
  const advancedType = draft.type !== 'cron' && draft.type !== 'at';

  return (
    <section className="page page--triggers" data-testid="triggers-page">
      <header className="page__header">
        <div>
          <h2>{t('triggers.title')}</h2>
          <p className="muted">{t('triggers.subtitle')}</p>
        </div>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => {
            void load();
            void loadFirings();
          }}
          disabled={loading}
          data-testid="refresh-triggers"
          title={t('tooltip.refresh')}
        >
          <IconRefresh size={14} className={loading ? 'icon icon--spin' : 'icon'} />
          {t('common.refresh')}
        </button>
      </header>

      {loading && <p className="status-line" data-testid="triggers-loading"><span className="spinner" />{t('triggers.loading')}</p>}
      {error && (
        <p className="err" data-testid="triggers-error">
          {t('triggers.error.load')}（{error}）
        </p>
      )}
      {message && <p className="ok" data-testid="triggers-message">{message}</p>}

      <div className="table-wrap">
      <table className="table" data-testid="trigger-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>{t('triggers.form.type')}</th>
            <th>能力</th>
            <th>状态</th>
            <th>版本</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 && !loading ? (
            <tr>
              <td colSpan={6} className="muted" data-empty data-testid="triggers-empty">
                {t('triggers.empty')}
              </td>
            </tr>
          ) : null}
          {items.map((tg) => (
            <tr key={tg.triggerId} data-testid={`trigger-row-${tg.triggerId}`}>
              <td>
                <code title={tg.triggerId}>{tg.triggerId}</code>
              </td>
              <td title={tg.type}>{triggerTypeLabel(tg.type)}</td>
              <td>
                {tg.arguments?.title ? (
                  <>
                    <strong>{String(tg.arguments.title)}</strong>
                    <br />
                  </>
                ) : null}
                <code>{tg.capabilityId}</code>
              </td>
              <td>
                <span
                  className={`badge badge--${tg.status}`}
                  title={TRIGGER_STATUS_LABELS[tg.status] ?? tg.status}
                >
                  {triggerStatusLabel(tg.status)}
                </span>
              </td>
              <td>v{tg.version}</td>
              <td>
                {tg.status === 'enabled' ? (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm btn--danger"
                    data-testid={`disable-${tg.triggerId}`}
                    onClick={() => void disable(tg.triggerId, tg.version)}
                    title={t('common.disable')}
                  >
                    {t('common.disable')}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    data-testid={`enable-${tg.triggerId}`}
                    onClick={() => void enable(tg.triggerId, tg.version)}
                    title={t('common.enable')}
                  >
                    {t('common.enable')}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      <section className="automation-runs" data-testid="trigger-firings">
        <h3>最近运行</h3>
        {firings.length === 0 ? (
          <p className="muted">还没有自动化运行记录。</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>触发器</th>
                  <th>状态</th>
                  <th>尝试</th>
                  <th>时间</th>
                  <th>结果</th>
                </tr>
              </thead>
              <tbody>
                {firings.map((firing) => (
                  <tr key={firing.firingId}>
                    <td><code>{firing.triggerId}</code></td>
                    <td><span className={`badge badge--${firing.status}`}>{firing.status}</span></td>
                    <td>{firing.attempt}/3</td>
                    <td>{new Date(firing.updatedAt).toLocaleString('zh-CN')}</td>
                    <td className={firing.error ? 'err' : 'muted'}>
                      {String(firing.error?.message ?? firing.commandId ?? '—')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <form
        className="form"
        data-testid="trigger-form"
        onSubmit={(e) => {
          e.preventDefault();
          void handleCreate();
        }}
      >
        <h3>新建自动化</h3>
        <p className="form-hint">给 AI 一个任务，它会按设定的时间自动运行，结果回传到会话。</p>
        {isAgentPrompt ? (
          <>
            <label>
              名称
              <input
                type="text"
                value={String(draft.arguments?.title ?? '')}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    arguments: { ...draft.arguments, title: event.target.value }
                  })
                }
                placeholder="例如：每日销售日报"
                required
                data-testid="trigger-name"
              />
            </label>
            <label>
              任务说明（Prompt）
              <textarea
                value={String(draft.arguments?.prompt ?? '')}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    arguments: { ...draft.arguments, prompt: event.target.value }
                  })
                }
                placeholder="例如：汇总昨天的销售数据，生成管理层日报和汇报演示文稿。"
                required
                data-testid="trigger-agent-prompt"
              />
            </label>
            <label>
              运行方式
              <select
                value={scheduleMode}
                onChange={(event) => setScheduleMode(event.target.value as ScheduleMode)}
                data-testid="trigger-schedule-mode"
              >
                <option value="daily">每天</option>
                <option value="weekly">每周</option>
                <option value="monthly">每月</option>
                <option value="once">一次性</option>
              </select>
            </label>
            {scheduleMode === 'weekly' ? (
              <label>
                周几运行
                <select
                  value={scheduleWeekday}
                  onChange={(event) => setScheduleWeekday(Number(event.target.value))}
                  data-testid="trigger-weekday"
                >
                  <option value={1}>周一</option>
                  <option value={2}>周二</option>
                  <option value={3}>周三</option>
                  <option value={4}>周四</option>
                  <option value={5}>周五</option>
                  <option value={6}>周六</option>
                  <option value={0}>周日</option>
                </select>
              </label>
            ) : null}
            {scheduleMode === 'monthly' ? (
              <label>
                每月几号运行
                <select
                  value={scheduleDay}
                  onChange={(event) => setScheduleDay(Number(event.target.value))}
                  data-testid="trigger-day"
                >
                  {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
                    <option key={day} value={day}>
                      {day} 日
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {scheduleMode === 'once' ? (
              <label>
                运行时间
                <input
                  type="datetime-local"
                  value={runAt}
                  onChange={(event) => setRunAt(event.target.value)}
                  required
                  data-testid="trigger-at"
                />
              </label>
            ) : (
              <label>
                运行时间
                <input
                  type="time"
                  value={scheduleTime}
                  onChange={(event) => setScheduleTime(event.target.value)}
                  required
                  data-testid="trigger-time"
                />
              </label>
            )}
          </>
        ) : null}
        <details className="advanced-fields" open={!isAgentPrompt || undefined}>
          <summary>高级设置</summary>
          <label>
            {t('triggers.form.plugin')}
            <input
              type="text"
              value={draft.pluginId}
              onChange={(e) => setDraft({ ...draft, pluginId: e.target.value })}
              data-testid="trigger-plugin"
              placeholder="例如：company.crm"
              required
            />
          </label>
          <label>
            {t('triggers.form.capability')}
            <input
              type="text"
              value={draft.capabilityId}
              onChange={(e) => setDraft({ ...draft, capabilityId: e.target.value })}
              data-testid="trigger-capability"
              placeholder="例如：crm.customer.sync"
              required
            />
          </label>
          <label>
            触发方式（高级）
            <select
              value={advancedType ? draft.type : ''}
              onChange={(e) => {
                const value = e.target.value;
                if (value === '') {
                  setDraft({ ...draft, type: 'cron', condition: null });
                  return;
                }
                const type = value as TriggerType;
                setDraft({
                  ...draft,
                  type,
                  config:
                    type === 'every'
                      ? { interval_seconds: 3600 }
                      : type === 'event'
                        ? { subscribe: '' }
                        : {
                            interval_seconds: 300,
                            probe_capability_id: '',
                            probe_arguments: {}
                          },
                  condition:
                    type === 'condition'
                      ? { op: 'eq', path: 'value', value: true }
                      : null
                });
              }}
              data-testid="trigger-type"
            >
              <option value="">按上方时间运行（默认定时）</option>
              <option value="every">固定间隔</option>
              <option value="event">业务事件</option>
              <option value="condition">条件触发</option>
            </select>
          </label>
        {draft.type === 'every' ? (
          <label>
            运行间隔
            <select
              value={Number(draft.config.interval_seconds ?? 3600)}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  config: { interval_seconds: Number(event.target.value) }
                })
              }
              data-testid="trigger-every-interval"
            >
              <option value={60}>每分钟</option>
              <option value={300}>每 5 分钟</option>
              <option value={3600}>每小时</option>
              <option value={86400}>每天</option>
            </select>
          </label>
        ) : null}
        {draft.type === 'event' ? (
          <label>
            业务事件
            <input
              value={String(draft.config.subscribe ?? '')}
              onChange={(event) =>
                setDraft({ ...draft, config: { subscribe: event.target.value } })
              }
              placeholder="例如：crm.ticket.created"
              required
              data-testid="trigger-event"
            />
            <span className="form-hint">
              任务参数可用 {'{{event.ticket.id}}'} 插入文本，或用
              {' {"$event":"ticket.id"} '}保留数字、数组等原始类型。
            </span>
          </label>
        ) : null}
        {draft.type === 'condition' ? (
          <>
            <label>
              检查间隔
              <select
                value={Number(draft.config.interval_seconds ?? 300)}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    config: {
                      ...draft.config,
                      interval_seconds: Number(event.target.value)
                    }
                  })
                }
                data-testid="trigger-condition-interval"
              >
                <option value={60}>每分钟</option>
                <option value={300}>每 5 分钟</option>
                <option value={900}>每 15 分钟</option>
                <option value={3600}>每小时</option>
              </select>
            </label>
            <label>
              条件表达式（JSON）
              <textarea
                value={JSON.stringify(draft.condition ?? {}, null, 2)}
                onChange={(event) => {
                  try {
                    setDraft({ ...draft, condition: JSON.parse(event.target.value) });
                  } catch {
                    // Keep the last valid condition while typing.
                  }
                }}
                data-testid="trigger-condition-json"
              />
            </label>
            <label>
              只读 Probe 能力
              <input
                value={String(draft.config.probe_capability_id ?? '')}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    config: {
                      ...draft.config,
                      probe_capability_id: event.target.value
                    }
                  })
                }
                placeholder="例如：crm.pipeline.snapshot"
                required
                data-testid="trigger-condition-probe"
              />
            </label>
            <label>
              Probe 参数（JSON）
              <textarea
                value={JSON.stringify(draft.config.probe_arguments ?? {}, null, 2)}
                onChange={(event) => {
                  try {
                    setDraft({
                      ...draft,
                      config: {
                        ...draft.config,
                        probe_arguments: JSON.parse(event.target.value)
                      }
                    });
                  } catch {
                    // Keep the last valid probe arguments while typing.
                  }
                }}
                data-testid="trigger-condition-probe-arguments"
              />
            </label>
          </>
        ) : null}
          <label>
            任务参数（JSON）
            <textarea
              value={JSON.stringify(draft.arguments ?? {}, null, 2)}
              onChange={(event) => {
                try {
                  setDraft({ ...draft, arguments: JSON.parse(event.target.value) });
                } catch {
                  // Keep the last valid parameter object while the user is typing.
                }
              }}
              placeholder="{}"
              data-testid="trigger-config"
            />
          </label>
        </details>
        <button
          type="submit"
          className="btn btn--primary"
          disabled={busy}
          data-testid="trigger-submit"
          title={t('triggers.form.save')}
        >
          {busy ? t('common.loading') : t('triggers.form.save')}
        </button>
      </form>
    </section>
  );
}
