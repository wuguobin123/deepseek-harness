/**
 * Session header.
 *
 * Re-implements webUI's `<SessionHeader>` occupant of
 * `conversation.session.header`. Shows the active session's title,
 * workspace, and stat chips (token count, plan mode, goal progress).
 * Slots around the title (`conversation.session.header.<id>`) are
 * filled by features like `ui-goal` and `ui-plan`.
 */
import React from 'react'
import { GoalIndicator } from '../goal/GoalIndicator'

export interface GoalStatusLite {
  total: number
  completed: number
  failed: number
  inProgress: number
}

export interface SessionHeaderProps {
  title: string
  workspaceLabel: string | null
  tokenCount?: number
  planMode: boolean
  goal?: GoalStatusLite | null
  goalSlot: React.ReactNode
  planSlot: React.ReactNode
  onRename: (title: string) => void
  onOpenDetails: () => void
}

export function SessionHeader({
  title, workspaceLabel, tokenCount, planMode, goal, goalSlot, planSlot,
  onRename, onOpenDetails,
}: SessionHeaderProps): React.JSX.Element {
  return (
    <header className="session-header" data-testid="session-header">
      <div className="session-header__title-row">
        <input
          className="session-header__title"
          value={title}
          onChange={(e) =>{  onRename(e.target.value) }}
          data-testid="session-title"
        />
        {workspaceLabel ? (
          <span className="session-header__workspace" data-testid="session-workspace">{workspaceLabel}</span>
        ) : null}
        {typeof tokenCount === 'number' ? (
          <span className="session-header__tokens" data-testid="session-tokens">
            {tokenCount.toLocaleString()} tokens
          </span>
        ) : null}
      </div>
      <div className="session-header__slots" data-testid="session-header-slots">
        {planMode ? planSlot : null}
        {goal ? <GoalIndicator goal={{ id: 'active', title: '当前目标', progress: goal.total ? goal.completed / goal.total : 0, status: goal.failed > 0 ? 'abandoned' : goal.completed >= goal.total ? 'achieved' : 'in-progress' }} /> : null}
        {goalSlot}
      </div>
      <button type="button" className="ghost" data-testid="session-details" onClick={onOpenDetails}>
        会话详情
      </button>
    </header>
  )
}
