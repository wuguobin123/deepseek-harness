/**
 * Subagent panel — active delegations.
 *
 * Re-implements webUI's `<SubagentPanel>` detail-panel occupant.
 * Lists running subagents and their delegation status.
 */

export interface SubagentRow {
  id: string
  agentName: string
  prompt: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  startedAt: number
  finishedAt?: number
}

export interface SubagentPanelProps {
  rows: SubagentRow[]
  onSelect?: (row: SubagentRow) => void
}

export function SubagentPanel({ rows, onSelect }: SubagentPanelProps): React.JSX.Element {
  return (
    <section className="subagent-panel" data-testid="subagent-panel">
      <header className="subagent-panel__header">
        <h2 className="subagent-panel__title">子智能体</h2>
        <span className="subagent-panel__count">{rows.length}</span>
      </header>
      {rows.length === 0 ? (
        <p className="subagent-panel__empty">暂无子智能体活动</p>
      ) : (
        <ul className="subagent-panel__list" data-testid="subagent-list">
          {rows.map(row => (
            <li
              key={row.id}
              className={`subagent-panel__item subagent-panel__item--${row.status}`}
              data-testid="subagent-item"
              data-subagent-id={row.id}
              onClick={() => onSelect?.(row)}
            >
              <span className="subagent-panel__name">{row.agentName}</span>
              <span className="subagent-panel__status">{row.status}</span>
              <span className="subagent-panel__prompt">{row.prompt}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
