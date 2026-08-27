import React from 'react'
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import type { SessionState } from '../shared/contracts'
import { ApprovalsPage } from './features/approvals/ApprovalsPage'
import { AssistantPage } from './features/assistant/AssistantPage'
import { AssistantProvider } from './features/assistant/AssistantContext'
import { HistoryPage } from './features/history/HistoryPage'
import { HomePage } from './features/home/HomePage'
import { SettingsPage } from './features/settings/SettingsPage'
import { TasksPage } from './features/tasks/TasksPage'
import {
  IconApproval,
  IconBook,
  IconGear,
  IconHome,
  IconLogo,
  IconPlay,
} from './components/icons'
import { useSessionStore } from './stores/session'
import * as api from './api'

const NAV_ITEMS = [
  { to: '/', testId: 'nav-home', label: '工作台', Icon: IconHome, end: true },
  { to: '/tasks', testId: 'nav-tasks', label: '任务', Icon: IconPlay },
  { to: '/approvals', testId: 'nav-approvals', label: '待我处理', Icon: IconApproval },
  { to: '/history', testId: 'nav-history', label: '历史', Icon: IconBook },
] as const

const SETTINGS_NAV_ITEM = { to: '/settings', testId: 'nav-settings', label: '设置', Icon: IconGear } as const

function Shell({ session }: { session: SessionState }): React.JSX.Element {
  const location = useLocation()
  const [serviceOnline, setServiceOnline] = React.useState<boolean | null>(null)

  React.useEffect(() => {
    let active = true
    void api.host
      .describe()
      .then(() => { if (active) setServiceOnline(true) })
      .catch(() => { if (active) setServiceOnline(false) })
    return () => {
      active = false
    }
  }, [session.baseUrl])

  return (
    <div className="shell" data-testid="shell">
      <aside className="sidebar" aria-label="主导航">
        <div className="sidebar__brand">
          <span className="sidebar__logo" aria-hidden="true"><IconLogo size={13} /></span>
          <h1 className="sidebar__title">小薇</h1>
        </div>
        <nav className="sidebar__nav">
          <ul className="nav-primary">
            {NAV_ITEMS.map(({ to, testId, label, Icon, ...item }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={'end' in item ? item.end : false}
                  data-testid={testId}
                  className={({ isActive }) =>
                    isActive || (to === '/' && location.pathname.startsWith('/assistant'))
                      ? 'active'
                      : undefined
                  }
                >
                  <Icon size={16} />
                  {label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="sidebar__footer">
          <NavLink
            to={SETTINGS_NAV_ITEM.to}
            data-testid={SETTINGS_NAV_ITEM.testId}
            className={({ isActive }) => (isActive ? 'sidebar__settings is-active' : 'sidebar__settings')}
          >
            <SETTINGS_NAV_ITEM.Icon size={16} />
            {SETTINGS_NAV_ITEM.label}
          </NavLink>
          <div className="sidebar__footer-status" data-testid="service-status">
            <span className={`service-status ${serviceOnline === false ? 'is-offline' : ''}`}>
              <i />
              {serviceOnline === null ? '正在检查服务' : serviceOnline ? '服务正常' : '服务未连接'}
            </span>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span className="topbar__title" data-testid="topbar-base-url" title={session.baseUrl}>
            {session.baseUrl}
          </span>
        </header>
        <main className="main" data-testid="main">
          <AssistantProvider>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/assistant/:sessionId" element={<AssistantPage />} />
              <Route path="/tasks" element={<TasksPage />} />
              <Route path="/approvals" element={<ApprovalsPage />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </AssistantProvider>
        </main>
      </div>
    </div>
  )
}

export function App(): React.JSX.Element {
  const session = useSessionStore(state => state.session)
  const initialized = useSessionStore(state => state.initialized)
  const refresh = useSessionStore(state => state.refresh)

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  if (!initialized) {
    return (
      <div className="boot" data-testid="boot">
        <span className="spinner" aria-hidden="true" />
        正在加载…
      </div>
    )
  }

  return <Shell session={session} />
}
