/**
 * Workflow run panel — multi-step workflow execution view.
 *
 * Re-implements webUI's `<WorkflowRunPanel>` detail-panel occupant.
 * Lists the run's steps with state and timing.
 */

export interface WorkflowStep {
  id: string
  title: string
  state: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  startedAt?: number
  finishedAt?: number
  error?: string
}

export interface WorkflowRun {
  id: string
  name: string
  steps: WorkflowStep[]
}

export interface WorkflowRunPanelProps {
  run: WorkflowRun | null
  onCancel?: (runId: string) => void
}

export function WorkflowRunPanel({ run, onCancel }: WorkflowRunPanelProps): React.JSX.Element | null {
  if (!run) return null
  return (
    <section className="workflow-run-panel" data-testid="workflow-run-panel" data-run-id={run.id}>
      <header className="workflow-run-panel__header">
        <h2 className="workflow-run-panel__title">{run.name}</h2>
        {onCancel ? (
          <button type="button" className="ghost" data-testid="workflow-run-cancel" onClick={() =>{  onCancel(run.id) }}>
            取消
          </button>
        ) : null}
      </header>
      <ol className="workflow-run-panel__steps" data-testid="workflow-run-steps">
        {run.steps.map(s => (
          <li
            key={s.id}
            className={`workflow-run-panel__step workflow-run-panel__step--${s.state}`}
            data-testid="workflow-run-step"
            data-step-id={s.id}
            data-state={s.state}
          >
            <span className="workflow-run-panel__step-title">{s.title}</span>
            {s.error ? <span className="workflow-run-panel__step-error">{s.error}</span> : null}
          </li>
        ))}
      </ol>
    </section>
  )
}
