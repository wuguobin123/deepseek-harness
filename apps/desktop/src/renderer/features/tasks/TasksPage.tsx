import React from 'react';
import { IconInbox, IconRefresh, IconSparkles } from '../../components/icons';
import { workbenchApi } from '../../api';
import { useAssistant } from '../assistant/AssistantContext';

interface TaskRow {
  id: string;
  message: string;
  status: string;
  updatedAt: string;
  traceId: string;
  source: 'agent' | 'workflow';
  detail: string;
  phase: string;
  version: number;
  conversationId?: string;
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function clampLimit(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(value)));
}

function parseNextCursor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

interface TaskListResponseBody {
  items?: unknown;
  next_cursor?: unknown;
}

export function taskConversationId(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const task = value as Record<string, unknown>;
  const direct = task.conversationId;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();

  const taskId = task.taskId;
  if (typeof taskId === 'string' && taskId.startsWith('conversation:')) {
    const conversationId = taskId.slice('conversation:'.length).trim();
    if (conversationId) return conversationId;
  }

  const input = task.input;
  if (input && typeof input === 'object') {
    const conversationId = (input as Record<string, unknown>).conversationId;
    if (typeof conversationId === 'string' && conversationId.trim()) {
      return conversationId.trim();
    }
  }

  // Trigger-originated commands carry the conversation only in the step
  // result output (execution.stepResults[].output.conversationId).
  const execution = task.execution;
  if (execution && typeof execution === 'object') {
    const stepResults = (execution as Record<string, unknown>).stepResults;
    if (Array.isArray(stepResults)) {
      for (const step of stepResults) {
        if (!step || typeof step !== 'object') continue;
        const output = (step as Record<string, unknown>).output;
        if (!output || typeof output !== 'object') continue;
        const conversationId = (output as Record<string, unknown>).conversationId;
        if (typeof conversationId === 'string' && conversationId.trim()) {
          return conversationId.trim();
        }
      }
    }
  }
  return undefined;
}

const STATUS_LABELS: Record<string, string> = {
  awaiting_confirmation: '待确认',
  running: '执行中',
  waiting_approval: '待审批',
  succeeded: '已完成',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消'
};

export function TasksPage(): JSX.Element {
  const { openAssistant, selectConversation } = useAssistant();
  const [items, setItems] = React.useState<TaskRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [actingId, setActingId] = React.useState<string | null>(null);
  const [pageSize, setPageSize] = React.useState<number>(DEFAULT_PAGE_SIZE);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);
  const [loadedPages, setLoadedPages] = React.useState(0);
  const [reloadToken, setReloadToken] = React.useState(0);

  const refresh = React.useCallback((): void => {
    setRefreshing(true);
    setReloadToken((token) => token + 1);
  }, []);

  const handlePageSizeChange = React.useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>): void => {
      const next = clampLimit(Number(event.target.value));
      setPageSize(next);
      setRefreshing(true);
      setReloadToken((token) => token + 1);
    },
    []
  );

  function openTaskConversation(item: TaskRow): void {
    if (!item.conversationId) return;
    openAssistant();
    void selectConversation(item.conversationId);
  }

  async function cancelAgentRun(item: TaskRow): Promise<void> {
    setActingId(item.id);
    setError(null);
    try {
      const response = await workbenchApi.request({
        method: 'POST',
        path: `/api/agent-runs/${encodeURIComponent(item.id)}/cancel`
      });
      if (response.status >= 400) throw new Error(`HTTP ${response.status}`);
      setItems((current) =>
        current.map((candidate) =>
          candidate.id === item.id && candidate.source === 'agent'
            ? { ...candidate, status: 'cancelled', phase: 'terminal' }
            : candidate
        )
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setActingId(null);
    }
  }

  async function confirmWorkflow(item: TaskRow): Promise<void> {
    setActingId(item.id);
    setError(null);
    try {
      const updated = await workbenchApi.confirmCommand(item.id, item.version);
      setItems((current) =>
        current.map((candidate) =>
          candidate.id === item.id && candidate.source === 'workflow'
            ? {
                ...candidate,
                status: updated.command.status,
                version: updated.command.version,
                updatedAt: updated.command.updatedAt ?? candidate.updatedAt
              }
            : candidate
        )
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setActingId(null);
    }
  }

  async function cancelWorkflow(item: TaskRow): Promise<void> {
    setActingId(item.id);
    setError(null);
    try {
      const updated = await workbenchApi.cancelCommand(item.id, item.version);
      setItems((current) =>
        current.map((candidate) =>
          candidate.id === item.id && candidate.source === 'workflow'
            ? {
                ...candidate,
                status: updated.command.status,
                version: updated.command.version,
                updatedAt: updated.command.updatedAt ?? candidate.updatedAt
              }
            : candidate
        )
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setActingId(null);
    }
  }

  React.useEffect(() => {
    let active = true;
    setItems([]);
    setNextCursor(null);
    setLoadedPages(0);
    setLoading(true);
    const params = new URLSearchParams();
    params.set('limit', String(pageSize));
    void workbenchApi
      .request({ method: 'GET', path: `/api/tasks?${params.toString()}` })
      .then((response) => {
        if (!active) return;
        if (response.status >= 400) {
          throw new Error(`HTTP ${response.status}`);
        }
        const body = (response.body ?? {}) as TaskListResponseBody;
        const rows = Array.isArray(body.items)
          ? (body.items as Array<Record<string, unknown>>).map(parseTaskRow)
          : [];
        setItems(rows);
        setNextCursor(parseNextCursor(body.next_cursor));
        setLoadedPages(1);
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (active) {
          setLoading(false);
          setRefreshing(false);
        }
      });
    return () => {
      active = false;
    };
  }, [pageSize, reloadToken]);

  const loadMore = React.useCallback(async (): Promise<void> => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    const params = new URLSearchParams();
    params.set('limit', String(pageSize));
    params.set('cursor', nextCursor);
    try {
      const response = await workbenchApi.request({
        method: 'GET',
        path: `/api/tasks?${params.toString()}`
      });
      if (response.status >= 400) throw new Error(`HTTP ${response.status}`);
      const body = (response.body ?? {}) as TaskListResponseBody;
      const rows = Array.isArray(body.items)
        ? (body.items as Array<Record<string, unknown>>).map(parseTaskRow)
        : [];
      setItems((current) => {
        const seen = new Set(current.map((item) => `${item.source}:${item.id}`));
        const appended = rows.filter(
          (item) => !seen.has(`${item.source}:${item.id}`)
        );
        return [...current, ...appended];
      });
      setNextCursor(parseNextCursor(body.next_cursor));
      setLoadedPages((count) => count + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, nextCursor, pageSize]);

  function parseTaskRow(raw: Record<string, unknown>): TaskRow {
    const source = raw.source === 'agent' ? 'agent' : 'workflow';
    const fallbackMessage =
      source === 'agent' ? '未命名 Agent 任务' : '未命名流程任务';
    const fallbackDetail = source === 'agent' ? 'Agent 任务' : '业务工作流';
    const fallbackPhase = source === 'agent' ? 'turn_boundary' : '';
    return {
      id: String(raw.id ?? ''),
      message: String(raw.message ?? fallbackMessage),
      status: String(raw.status ?? 'running'),
      updatedAt: String(raw.updatedAt ?? ''),
      traceId: String(raw.traceId ?? ''),
      source,
      detail: String(raw.detail ?? fallbackDetail),
      phase: String(raw.phase ?? fallbackPhase),
      version: Number(raw.version ?? 1),
      conversationId: taskConversationId(raw)
    };
  }

  return (
    <section className="page page--tasks" data-testid="tasks-page">
      <header className="page__header">
        <div>
          <h2>进行中</h2>
          <p>查看 AI 正在执行、等待确认和最近完成的业务任务。</p>
        </div>
        <div className="page__header-actions">
          <label className="tasks-page-size" htmlFor="tasks-page-size">
            <span>每页</span>
            <select
              id="tasks-page-size"
              data-testid="tasks-page-size"
              value={String(pageSize)}
              onChange={handlePageSizeChange}
              disabled={loading || refreshing}
            >
              {[10, 20, 50, 100].map((option) => (
                <option key={option} value={String(option)}>
                  {option} 条
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            data-testid="tasks-refresh"
            onClick={refresh}
            disabled={loading || refreshing}
          >
            <IconRefresh size={14} />
            {refreshing ? '刷新中…' : '刷新'}
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => openAssistant()}
          >
            <IconSparkles size={14} />
            发起新任务
          </button>
        </div>
      </header>
      <p className="tasks-page-meta" data-testid="tasks-page-meta">
        {items.length > 0
          ? `已加载 ${items.length} 条${loadedPages > 1 ? `（第 ${loadedPages} 页）` : ''}`
          : '按更新时间倒序展示，按需翻页加载更多历史任务。'}
      </p>
      {loading ? <p className="status-line"><span className="spinner" />正在加载任务…</p> : null}
      {error ? <p className="err">加载失败：{error}</p> : null}
      {!loading && !error && items.length === 0 ? (
        <div className="empty">
          <IconInbox size={30} />
          <p className="empty__title">还没有任务</p>
          <p>打开 AI 助手，直接描述你想完成的工作。</p>
        </div>
      ) : null}
      {items.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>任务</th><th>类型</th><th>状态</th><th>更新时间</th><th>追踪</th><th>操作</th></tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={`${item.source}:${item.id}`}
                  className={item.conversationId ? 'task-row--linked' : undefined}
                  data-testid={`task-row-${item.source}-${item.id}`}
                  data-conversation-id={item.conversationId}
                  tabIndex={item.conversationId ? 0 : undefined}
                  aria-label={
                    item.conversationId
                      ? `打开任务对话：${item.message || '未命名任务'}`
                      : undefined
                  }
                  onClick={() => openTaskConversation(item)}
                  onKeyDown={(event) => {
                    if (
                      event.target === event.currentTarget &&
                      (event.key === 'Enter' || event.key === ' ')
                    ) {
                      event.preventDefault();
                      openTaskConversation(item);
                    }
                  }}
                >
                  <td><strong>{item.message || '未命名任务'}</strong><small className="table-sub">{item.id} · {item.detail}</small></td>
                  <td>{item.source === 'agent' ? 'Agent' : '工作流'}</td>
                  <td><span className={`badge badge--${item.status}`}>{STATUS_LABELS[item.status] ?? item.status}</span></td>
                  <td>{item.updatedAt ? new Date(item.updatedAt).toLocaleString('zh-CN') : '—'}</td>
                  <td><code>{item.traceId || '—'}</code></td>
                  <td>
                    {item.source === 'agent' && item.phase !== 'terminal' ? (
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled={actingId === item.id}
                        onClick={(event) => {
                          event.stopPropagation();
                          void cancelAgentRun(item);
                        }}
                      >
                        {actingId === item.id ? '停止中…' : '停止'}
                      </button>
                    ) : item.source === 'workflow' && item.status === 'awaiting_confirmation' ? (
                      <span className="button-group">
                        <button
                          type="button"
                          className="btn btn--primary btn--sm"
                          disabled={actingId === item.id}
                          onClick={(event) => {
                            event.stopPropagation();
                            void confirmWorkflow(item);
                          }}
                        >
                          确认执行
                        </button>
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          disabled={actingId === item.id}
                          onClick={(event) => {
                            event.stopPropagation();
                            void cancelWorkflow(item);
                          }}
                        >
                          取消
                        </button>
                      </span>
                    ) : item.source === 'workflow' && ['queued', 'running'].includes(item.status) ? (
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled={actingId === item.id}
                        onClick={(event) => {
                          event.stopPropagation();
                          void cancelWorkflow(item);
                        }}
                      >
                        取消
                      </button>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <div className="tasks-page-footer" data-testid="tasks-page-footer">
        {nextCursor ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            data-testid="tasks-load-more"
            onClick={() => {
              void loadMore();
            }}
            disabled={loadingMore}
          >
            {loadingMore ? '加载中…' : '加载更多任务'}
          </button>
        ) : !loading && items.length > 0 ? (
          <span className="tasks-page-footer__hint">已经到末尾，没有更多任务。</span>
        ) : null}
      </div>
    </section>
  );
}
