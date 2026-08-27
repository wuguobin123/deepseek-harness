/**
 * Sidebar wiring — wires the individual sidebar feature components
 * (Brand, Workspace, Sessions, Skills, ConnectionStatus) into the
 * `ui-sidebar` slot tree.
 *
 * Replaces the legacy `Sidebar` component (if any) and the per-page
 * sidebar fragments from `HomePage` / `TasksPage` / `SettingsPage`.
 *
 * Slot registration (delegated to cordis-host.ts):
 * - `sidebar`                        → this component
 * - `sidebar.brand`                  → BrandMark
 * - `sidebar.section.workspace`      → WorkspacePanel
 * - `sidebar.section.sessions`       → SessionsPanel
 * - `sidebar.section.skills`         → SkillsPanel
 * - `sidebar.section.jobs`           → JobListPanel
 * - `sidebar.section.approvals`      → ApprovalQueue
 * - `sidebar.section.history`        → HistoryPanel
 * - `sidebar.section.settings`       → Settings panel link
 * - `sidebar.status`                 → ConnectionStatus
 */
import { BrandMark } from './BrandMark'
import { WorkspacePanel, type WorkspaceListEntry } from './WorkspacePanel'
import { SessionsPanel, type SessionListEntry } from './SessionsPanel'
import { SkillsPanel, type SkillRow } from './SkillsPanel'
import { ConnectionStatus, type ConnectionState } from './ConnectionStatus'
import { JobListPanel, type JobRow } from '../jobs/JobListPanel'
import { ApprovalQueue, type PendingInteraction } from '../approvals/ApprovalQueue'
import { HistoryPanel, type ArchivedSession } from '../history/HistoryPanel'

export interface SidebarRootProps {
  collapsed: boolean
  workspaces: WorkspaceListEntry[]
  sessions: SessionListEntry[]
  skills: SkillRow[]
  jobs: JobRow[]
  pending: PendingInteraction[]
  history: ArchivedSession[]
  connection: {
    state: ConnectionState
    hostLabel: string
    errorMessage?: string
  }
  onPickWorkspace: (id: string) => void
  onCreateWorkspace: () => void
  onTogglePinWorkspace: (id: string) => void
  onRemoveWorkspace: (id: string) => void
  onPickSession: (id: string) => void
  onCreateSession: () => void
  onArchiveSession: (id: string) => void
  onToggleSkill: (id: string) => void
  onOpenSkill: (id: string) => void
  onCancelJob: (id: string) => void
  onRetryJob: (id: string) => void
  onRespondPending: (id: string, choice: string) => void
  onDismissPending: (id: string) => void
  onRestoreSession: (id: string) => void
  onDeleteSession: (id: string) => void
  onReconnect: () => void
  onOpenTrustedHosts: () => void
  onOpenSettings: () => void
  onOpenHistory: () => void
  onOpenApprovals: () => void
  onOpenJobs: () => void
  onToggleCollapsed: () => void
}

export function SidebarRoot(props: SidebarRootProps): React.JSX.Element {
  const {
    collapsed, workspaces, sessions, skills, jobs, pending, history, connection,
    onPickWorkspace, onCreateWorkspace, onTogglePinWorkspace, onRemoveWorkspace,
    onPickSession, onCreateSession, onArchiveSession,
    onToggleSkill, onOpenSkill, onCancelJob, onRetryJob,
    onRespondPending, onDismissPending, onRestoreSession, onDeleteSession,
    onReconnect, onOpenTrustedHosts, onOpenSettings, onOpenHistory, onOpenApprovals,
    onOpenJobs, onToggleCollapsed,
  } = props

  return (
    <aside
      className={`sidebar ${collapsed ? 'is-collapsed' : ''}`}
      data-testid="sidebar"
      aria-expanded={!collapsed}
    >
      <header className="sidebar__header">
        <BrandMark />
        <button
          type="button"
          className="ghost"
          data-testid="sidebar-collapse"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
        >
          {collapsed ? '»' : '«'}
        </button>
      </header>

      <nav className="sidebar__nav" data-testid="sidebar-nav">
        <button
          type="button"
          className="sidebar__nav-item"
          data-testid="sidebar-open-jobs"
          onClick={onOpenJobs}
        >
          任务 {jobs.length > 0 ? `(${jobs.length})` : ''}
        </button>
        <button
          type="button"
          className="sidebar__nav-item"
          data-testid="sidebar-open-approvals"
          onClick={onOpenApprovals}
        >
          待办 {pending.length > 0 ? `(${pending.length})` : ''}
        </button>
        <button
          type="button"
          className="sidebar__nav-item"
          data-testid="sidebar-open-history"
          onClick={onOpenHistory}
        >
          历史
        </button>
        <button
          type="button"
          className="sidebar__nav-item"
          data-testid="sidebar-open-settings"
          onClick={onOpenSettings}
        >
          设置
        </button>
      </nav>

      <WorkspacePanel
        workspaces={workspaces}
        onPick={onPickWorkspace}
        onCreate={onCreateWorkspace}
        onTogglePin={onTogglePinWorkspace}
        onRemove={onRemoveWorkspace}
      />

      <SessionsPanel
        sessions={sessions}
        onPick={onPickSession}
        onCreate={onCreateSession}
        onArchive={onArchiveSession}
      />

      <SkillsPanel skills={skills} onToggle={onToggleSkill} onOpen={onOpenSkill} />

      <JobListPanel jobs={jobs} onCancel={onCancelJob} onRetry={onRetryJob} onOpen={() => undefined} />

      <ApprovalQueue items={pending} onRespond={onRespondPending} onDismiss={onDismissPending} />

      <HistoryPanel
        sessions={history}
        query=""
        onQueryChange={() => undefined}
        onRestore={onRestoreSession}
        onDelete={onDeleteSession}
      />

      <ConnectionStatus
        state={connection.state}
        hostLabel={connection.hostLabel}
        errorMessage={connection.errorMessage}
        onReconnect={onReconnect}
        onOpenTrustedHosts={onOpenTrustedHosts}
      />
    </aside>
  )
}
