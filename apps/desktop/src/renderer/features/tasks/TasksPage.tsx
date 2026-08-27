/**
 * Tasks page — running background jobs across all sessions.
 *
 * Aggregates `session/jobs` MuxFrames keyed by sessionId so the user can see
 * which shells, subprocesses, and subagents are still live and which have
 * settled. Sessions come from `api.session.list()`; the jobs view itself is
 * pushed by the host on every registry commit.
 *
 * Cancel-by-id is not surfaced — the registry owner is the session, so the
 * user closes a long-running task by going to its Assistant page and
 * pressing "取消". This page is read-only by design.
 */
import React from 'react'
import { useNavigate } from 'react-router-dom'
import * as api from '../../api'
import type { MuxFrame } from '../../../shared/contracts'

interface JobView {
  id: string
  kind: string
  label: string
  status: 'running' | 'stopping' | 'completed' | 'killed' | 'failed'
  detail?: string
  startedAt: number
  finishedAt?: number
}

interface SessionRow {
  sessionId: string
  title?: string
  jobs: JobView[]
}

const STATUS_LABEL: Record<JobView['status'], string> = {
  running: '运行中',
  stopping: '停止中',
  completed: '已完成',
  killed: '已终止',
  failed: '失败',
}

function isSessionJobsFrame(frame: MuxFrame): frame is Extract<MuxFrame, { type: 'session/jobs' }> {
  return frame.type === 'session/jobs'
}

function coerceJobs(jobs: ReadonlyArray<unknown>): JobView[] {
  return jobs.map((j) => {
    const raw = (j ?? {}) as Record<string, unknown>
    return {
      id: typeof raw.id === 'string' ? raw.id : '',
      kind: typeof raw.kind === 'string' ? raw.kind : '',
      label: typeof raw.label === 'string' ? raw.label : '',
      status: (typeof raw.status === 'string'
        ? raw.status
        : 'running') as JobView['status'],
      detail: typeof raw.detail === 'string' ? raw.detail : undefined,
      startedAt: Number(raw.startedAt ?? Date.now()),
      finishedAt: typeof raw.finishedAt === 'number' ? raw.finishedAt : undefined,
    }
  })
}

export function TasksPage(): React.JSX.Element {
  const navigate = useNavigate()
  const [rows, setRows] = React.useState<Map<string, SessionRow> | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const refreshSessions = React.useCallback(async (): Promise<void> => {
    try {
      const result = await api.session.list({})
      const sessions = result.items
      setRows((prev) => {
        const next = new Map<string, SessionRow>()
        for (const s of sessions) {
          const existing = prev?.get(s.sessionId)
          next.set(s.sessionId, {
            sessionId: s.sessionId,
            title: api.sessionTitle(s),
            jobs: existing?.jobs ?? [],
          })
        }
        return next
      })
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [])

  React.useEffect(() => {
    void refreshSessions()
  }, [refreshSessions])

  React.useEffect(() => {
    let active = true
    let unsubscribe: (() => Promise<void>) | null = null
    void api
      .subscribeMux((envelope) => {
        if (!active) return
        const frame = envelope.payload
        if (!isSessionJobsFrame(frame)) return
        setRows((prev) => {
          if (!prev) return prev
          const next = new Map(prev)
          const existing = next.get(frame.sessionId)
          next.set(frame.sessionId, {
            sessionId: frame.sessionId,
            title: existing?.title,
            jobs: coerceJobs(frame.jobs),
          })
          return next
        })
      })
      .then((u) => {
        if (!active) {
          void u()
          return
        }
        unsubscribe = u
      })
      .catch((err: unknown) => {
        if (active) setError((err as Error).message)
      })
    return () => {
      active = false
      if (unsubscribe) void unsubscribe()
    }
  }, [])

  const list = rows ? [...rows.values()] : null
  const totalRunning = list?.reduce((sum, row) => sum + row.jobs.filter(j => j.status === 'running').length, 0) ?? 0

  return (
    <section className="page page-tasks" data-testid="page-tasks">
      <header className="page-tasks__header">
        <div>
          <h1>进行中的任务</h1>
          <p className="muted">每个会话的后台作业（bash、subagent 等）实时汇总。</p>
        </div>
        <button type="button" className="primary" onClick={() => void refreshSessions()} data-testid="tasks-refresh">
          刷新会话列表
        </button>
      </header>
      {error ? (
        <p className="page-tasks__error" role="alert" data-testid="tasks-error">
          {error}
        </p>
      ) : null}
      {list === null ? (
        <p className="page-tasks__empty" data-testid="tasks-loading">正在加载会话…</p>
      ) : list.length === 0 ? (
        <p className="page-tasks__empty" data-testid="tasks-empty">
          还没有会话，回到「会话」页发起一次对话吧。
        </p>
      ) : (
        <>
          <p className="page-tasks__meta" data-testid="tasks-meta">
            {totalRunning === 0 ? '当前没有正在运行的作业。' : `${totalRunning} 个作业正在执行。`}
          </p>
          {list.map(row => (
            <article key={row.sessionId} className="task-card" data-testid={`task-card-${row.sessionId}`}>
              <header className="task-card__header">
                <button
                  type="button"
                  className="task-card__title"
                  onClick={() =>{  navigate(`/assistant/${row.sessionId}`) }}
                  data-testid={`task-card-open-${row.sessionId}`}
                >
                  <strong>{row.title?.trim() || `会话 ${row.sessionId.slice(0, 8)}`}</strong>
                  <small>{row.sessionId}</small>
                </button>
                <span className="task-card__count">{row.jobs.length} 个作业</span>
              </header>
              {row.jobs.length === 0 ? (
                <p className="task-card__empty">暂无作业。</p>
              ) : (
                <ul className="task-card__list">
                  {row.jobs.map(job => (
                    <li key={job.id} className={`task-card__item task-card__item--${job.status}`}>
                      <span className="task-card__kind">{job.kind}</span>
                      <span className="task-card__label">{job.label}</span>
                      <span className={`badge badge--${job.status}`}>{STATUS_LABEL[job.status]}</span>
                      {job.detail ? <small className="task-card__detail">{job.detail}</small> : null}
                    </li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </>
      )}
    </section>
  )
}
