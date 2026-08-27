/**
 * Plan mode panel.
 *
 * Re-implements webUI's `<PlanModePanel>` occupant of
 * `conversation.input.plan`. When plan mode is on, the composer
 * submits a planning request that produces a plan the user approves
 * before execution. The panel shows the in-flight plan steps and
 * approval buttons.
 */
import React from 'react'

export interface PlanStep {
  id: string
  title: string
  description?: string
  status: 'pending' | 'in-progress' | 'completed' | 'rejected'
}

export interface PlanModePanelProps {
  active: boolean
  steps: PlanStep[]
  onApprove: () => void
  onReject: (reason: string) => void
  onCancel: () => void
}

export function PlanModePanel({ active, steps, onApprove, onReject, onCancel }: PlanModePanelProps): React.JSX.Element | null {
  const [reason, setReason] = React.useState('')
  if (!active) return null
  return (
    <section className="plan-mode-panel" data-testid="plan-mode-panel">
      <header className="plan-mode-panel__header">
        <h3 className="plan-mode-panel__title">计划模式</h3>
        <button type="button" className="ghost" data-testid="plan-mode-cancel" onClick={onCancel}>
          退出计划
        </button>
      </header>
      <ol className="plan-mode-panel__steps" data-testid="plan-mode-steps">
        {steps.map(s => (
          <li
            key={s.id}
            className={`plan-mode-panel__step plan-mode-panel__step--${s.status}`}
            data-testid="plan-mode-step"
            data-step-id={s.id}
            data-status={s.status}
          >
            <span className="plan-mode-panel__step-title">{s.title}</span>
            {s.description ? <span className="plan-mode-panel__step-desc">{s.description}</span> : null}
          </li>
        ))}
      </ol>
      <footer className="plan-mode-panel__actions">
        <input
          type="text"
          className="plan-mode-panel__reason"
          placeholder="驳回理由（可选）"
          value={reason}
          onChange={(e) =>{  setReason(e.target.value) }}
          data-testid="plan-mode-reject-reason"
        />
        <button type="button" className="ghost" data-testid="plan-mode-reject" onClick={() =>{  onReject(reason) }}>
          驳回
        </button>
        <button type="button" className="primary" data-testid="plan-mode-approve" onClick={onApprove}>
          批准执行
        </button>
      </footer>
    </section>
  )
}
