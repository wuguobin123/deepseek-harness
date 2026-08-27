/**
 * Jobs panel.
 *
 * Re-implements webUI's `<JobListPanel>` occupant of
 * `sidebar.section.jobs`. Renders every running job surfaced by
 * `ctx.jobs.list()`. Each row supports cancel + retry + open-detail.
 * Replaces the legacy `TasksPage`.
 */

export interface JobRow {
  id: string
  title: string
  status: 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'
  progress?: number
  startedAt: number
  finishedAt?: number
  errorMessage?: string
}

export interface JobListPanelProps {
  jobs: JobRow[]
  onCancel: (id: string) => void
  onRetry: (id: string) => void
  onOpen: (id: string) => void
}

export function JobListPanel({ jobs, onCancel, onRetry, onOpen }: JobListPanelProps): React.JSX.Element {
  return (
    <section className="job-list-panel" data-testid="job-list-panel">
      <header className="job-list-panel__header">
        <h2 className="job-list-panel__title">任务</h2>
        <span className="job-list-panel__count">{jobs.length}</span>
      </header>
      {jobs.length === 0 ? (
        <p className="job-list-panel__empty" data-testid="job-list-empty">没有运行中的任务</p>
      ) : (
        <ul className="job-list-panel__list" data-testid="job-list">
          {jobs.map(j => (
            <li
              key={j.id}
              className={`job-list-panel__item job-list-panel__item--${j.status}`}
              data-testid="job-item"
              data-job-id={j.id}
              data-status={j.status}
            >
              <button
                type="button"
                className="job-list-panel__item-main"
                data-testid="job-open"
                onClick={() =>{  onOpen(j.id) }}
              >
                <h3 className="job-list-panel__item-title">{j.title}</h3>
                <span className="job-list-panel__item-meta">
                  {j.status} · {new Date(j.startedAt).toLocaleString()}
                </span>
                {typeof j.progress === 'number' ? (
                  <progress
                    className="job-list-panel__progress"
                    max={100}
                    value={j.progress}
                    data-testid="job-progress"
                    data-progress={j.progress}
                  />
                ) : null}
                {j.errorMessage ? (
                  <p className="job-list-panel__item-error" data-testid="job-error">{j.errorMessage}</p>
                ) : null}
              </button>
              <div className="job-list-panel__item-actions">
                {(j.status === 'running' || j.status === 'queued' || j.status === 'paused') ? (
                  <button
                    type="button"
                    className="ghost"
                    data-testid="job-cancel"
                    onClick={() =>{  onCancel(j.id) }}
                  >
                    取消
                  </button>
                ) : null}
                {(j.status === 'failed' || j.status === 'cancelled') ? (
                  <button
                    type="button"
                    className="primary"
                    data-testid="job-retry"
                    onClick={() =>{  onRetry(j.id) }}
                  >
                    重试
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
