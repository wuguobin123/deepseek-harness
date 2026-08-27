/**
 * Goal indicator — current task / outcome pinned to the header.
 *
 * Re-implements webUI's `<GoalIndicator>` occupant of
 * `conversation.session.header.lineage`. Shows the active goal with a
 * progress dot; clicking opens the goal detail.
 */

export interface Goal {
  id: string
  title: string
  progress: number
  status: 'in-progress' | 'achieved' | 'abandoned'
}

export interface GoalIndicatorProps {
  goal: Goal | null
  onOpenDetail?: (goal: Goal) => void
}

export function GoalIndicator({ goal, onOpenDetail }: GoalIndicatorProps): React.JSX.Element | null {
  if (!goal) return null
  return (
    <button
      type="button"
      className={`goal-indicator goal-indicator--${goal.status}`}
      data-testid="goal-indicator"
      data-goal-id={goal.id}
      onClick={() => onOpenDetail?.(goal)}
    >
      <span className="goal-indicator__dot" aria-hidden="true" />
      <span className="goal-indicator__title">{goal.title}</span>
      <span className="goal-indicator__progress">{Math.round(goal.progress * 100)}%</span>
    </button>
  )
}
