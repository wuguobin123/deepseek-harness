/**
 * Approvals page — pending tool-call approvals across all sessions.
 *
 * Subscribes to the mux stream and folds `approval/requested` / `approval/resolved`
 * frames into a per-session pending list. The envelope's `rpcId` is what the
 * host uses to settle a pending ask; clicking 同意 or 拒绝 calls `api.respond`
 * with `outcome: 'allowed-once'` or `'rejected'`.
 *
 * An approval can also be settled by a turn cancel upstream, so the page keeps
 * no local store — every `approval/resolved` it sees is authoritative and the
 * entry just disappears from the list.
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import * as api from '../../api';
import type { MuxFrame } from '../../../shared/contracts';

interface ApprovalRequestItem {
  rpcId: string;
  sessionId: string;
  approvalId: string;
  toolName: string;
  callId?: string;
  reason?: string;
  receivedAt: number;
}

interface PendingMap {
  byRpc: Map<string, ApprovalRequestItem>;
  /** insertion-ordered list of unique sessionIds with at least one pending ask */
  sessionIds: string[];
}

function emptyMap(): PendingMap {
  return { byRpc: new Map(), sessionIds: [] };
}

function isApprovalRequested(frame: MuxFrame): frame is Extract<MuxFrame, { type: 'approval/requested' }> {
  return frame.type === 'approval/requested';
}

function isApprovalResolved(frame: MuxFrame): frame is Extract<MuxFrame, { type: 'approval/resolved' }> {
  return frame.type === 'approval/resolved';
}

function upsert(map: PendingMap, item: ApprovalRequestItem): PendingMap {
  if (map.byRpc.has(item.rpcId)) return map;
  const byRpc = new Map(map.byRpc);
  byRpc.set(item.rpcId, item);
  if (!map.sessionIds.includes(item.sessionId)) {
    return { byRpc, sessionIds: [...map.sessionIds, item.sessionId] };
  }
  return { byRpc, sessionIds: map.sessionIds };
}

function removeByApprovalId(map: PendingMap, approvalId: string): PendingMap {
  let changed = false;
  const byRpc = new Map<string, ApprovalRequestItem>();
  for (const [rpcId, item] of map.byRpc) {
    if (item.approvalId === approvalId) {
      changed = true;
      continue;
    }
    byRpc.set(rpcId, item);
  }
  if (!changed) return map;
  const sessionIds = map.sessionIds.filter((sid) =>
    [...byRpc.values()].some((item) => item.sessionId === sid)
  );
  return { byRpc, sessionIds };
}

export function ApprovalsPage(): JSX.Element {
  const navigate = useNavigate();
  const [pending, setPending] = React.useState<PendingMap>(emptyMap);
  const [error, setError] = React.useState<string | null>(null);
  const [actingRpc, setActingRpc] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    let unsubscribe: (() => Promise<void>) | null = null;
    void api
      .subscribeMux((envelope) => {
        if (!active) return;
        const frame = envelope.payload as MuxFrame;
        if (isApprovalRequested(frame)) {
          setPending((prev) =>
            upsert(prev, {
              rpcId: envelope.rpcId,
              sessionId: frame.sessionId,
              approvalId: frame.approvalId,
              toolName: frame.toolName,
              callId: frame.callId,
              reason: frame.reason,
              receivedAt: Date.now()
            })
          );
          return;
        }
        if (isApprovalResolved(frame)) {
          setPending((prev) => removeByApprovalId(prev, frame.approvalId));
        }
      })
      .then((u) => {
        if (!active) {
          void u();
          return;
        }
        unsubscribe = u;
      })
      .catch((err: unknown) => {
        if (active) setError((err as Error).message);
      });
    return () => {
      active = false;
      if (unsubscribe) void unsubscribe();
    };
  }, []);

  const decide = React.useCallback(
    async (item: ApprovalRequestItem, outcome: 'allowed-once' | 'rejected'): Promise<void> => {
      setActingRpc(item.rpcId);
      setError(null);
      try {
        await api.respond(item.rpcId, { outcome });
        // The host will broadcast approval/resolved next; remove locally too so the
        // UI is snappy even if the SSE roundtrip is slow.
        setPending((prev) => removeByApprovalId(prev, item.approvalId));
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setActingRpc(null);
      }
    },
    []
  );

  const total = pending.byRpc.size;

  return (
    <section className="page page-approvals" data-testid="page-approvals">
      <header className="page-approvals__header">
        <div>
          <h1>待我处理</h1>
          <p className="muted">模型在请求执行需要人工确认的工具调用。</p>
        </div>
        {total > 0 ? <span className="page-approvals__count">{total} 项待处理</span> : null}
      </header>
      {error ? (
        <p className="page-approvals__error" role="alert" data-testid="approvals-error">
          {error}
        </p>
      ) : null}
      {total === 0 ? (
        <p className="page-approvals__empty" data-testid="approvals-empty">
          当前没有待审批的请求。
        </p>
      ) : (
        pending.sessionIds.map((sessionId) => {
          const items = [...pending.byRpc.values()].filter((item) => item.sessionId === sessionId);
          return (
            <article key={sessionId} className="approval-card" data-testid={`approval-card-${sessionId}`}>
              <header className="approval-card__header">
                <button
                  type="button"
                  className="approval-card__title"
                  onClick={() => navigate(`/assistant/${sessionId}`)}
                  data-testid={`approval-card-open-${sessionId}`}
                >
                  会话 {sessionId.slice(0, 8)}
                </button>
                <span className="approval-card__count">{items.length} 项</span>
              </header>
              <ul className="approval-card__list">
                {items.map((item) => (
                  <li key={item.rpcId} className="approval-card__item" data-testid={`approval-row-${item.approvalId}`}>
                    <div className="approval-card__main">
                      <strong>{item.toolName}</strong>
                      {item.reason ? <p className="approval-card__reason">{item.reason}</p> : null}
                      <small className="approval-card__meta">
                        approval {item.approvalId.slice(0, 8)} · rpc {item.rpcId.slice(0, 8)}
                      </small>
                    </div>
                    <div className="approval-card__actions">
                      <button
                        type="button"
                        className="primary"
                        disabled={actingRpc === item.rpcId}
                        onClick={() => void decide(item, 'allowed-once')}
                        data-testid={`approval-allow-${item.approvalId}`}
                      >
                        {actingRpc === item.rpcId ? '处理中…' : '同意'}
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        disabled={actingRpc === item.rpcId}
                        onClick={() => void decide(item, 'rejected')}
                        data-testid={`approval-reject-${item.approvalId}`}
                      >
                        拒绝
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </article>
          );
        })
      )}
    </section>
  );
}