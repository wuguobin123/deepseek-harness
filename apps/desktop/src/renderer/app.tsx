import React from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { SessionState } from '../shared/contracts';
import { AnomaliesPage } from './features/anomalies/AnomaliesPage';
import { AnomalyDetailPage } from './features/anomalies/AnomalyDetailPage';
import { ApprovalsPage } from './features/approvals/ApprovalsPage';
import { AssistantPage } from './features/assistant/AssistantPage';
import { AssistantProvider } from './features/assistant/AssistantContext';
import { BrowserWorkspaceProvider } from './features/browser/BrowserWorkspaceContext';
import { DocumentPreviewProvider } from './features/document-preview/DocumentPreviewContext';
import { AutomationsPage } from './features/automations/AutomationsPage';
import { HistoryPage } from './features/history/HistoryPage';
import { IntegrationsPage } from './features/integrations/IntegrationsPage';
import { KnowledgePage } from './features/knowledge/KnowledgePage';
import { ResourcesPage } from './features/resources/ResourcesPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { TasksPage } from './features/tasks/TasksPage';
import { TelesalesPage } from './features/telesales/TelesalesPage';
import { TriggersPage } from './features/triggers/TriggersPage';
import {
  IconApproval,
  IconBell,
  IconBook,
  IconGear,
  IconHome,
  IconLogo,
  IconPlay,
  IconPlug,
  IconRobot
} from './components/icons';
import { useSessionStore } from './stores/session';
import { workbenchApi } from './api';
import { t } from './i18n';
import { ToolsLauncher } from './components/ToolsLauncher/ToolsLauncher';
import { UpdateBadge } from './components/UpdateBadge';

const NAV_ITEMS = [
  { to: '/', testId: 'nav-home', label: '工作台', Icon: IconHome, end: true },
  { to: '/tasks', testId: 'nav-tasks', label: '任务', Icon: IconPlay },
  { to: '/approvals', testId: 'nav-approvals', label: '待我处理', Icon: IconApproval }
] as const;

const RESOURCE_NAV_ITEMS = [
  { to: '/knowledge', testId: 'nav-knowledge', label: '知识库', Icon: IconBook },
  { to: '/integrations', testId: 'nav-integrations', label: '业务系统', Icon: IconPlug },
  { to: '/automations', testId: 'nav-automations', label: '自动化', Icon: IconRobot },
  { to: '/settings', testId: 'nav-settings', label: '设置', Icon: IconGear }
] as const;

function Shell({ session }: { session: SessionState }): JSX.Element {
  const location = useLocation();
  const [serviceOnline, setServiceOnline] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    let active = true;
    void workbenchApi
      .request({ method: 'GET', path: '/api/context' })
      .then((response) => {
        if (active) setServiceOnline(response.status >= 200 && response.status < 400);
      })
      .catch(() => {
        if (active) setServiceOnline(false);
      });
    return () => {
      active = false;
    };
  }, [session.actorId, session.baseUrl, session.hasApiKey, session.tenantId]);

  return (
    <div className="shell" data-testid="shell">
      <aside className="sidebar" aria-label="主导航">
        <div className="sidebar__brand">
          <span className="sidebar__logo" aria-hidden="true"><IconLogo size={13} /></span>
          <h1 className="sidebar__title">{t('app.title')}</h1>
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
                    isActive || (to === '/' && location.pathname === '/assistant')
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
          <span className="nav-section__label">资源与配置</span>
          <ul className="nav-resources">
            {RESOURCE_NAV_ITEMS.map(({ to, testId, label, Icon }) => (
              <li key={to}>
                <NavLink to={to} data-testid={testId}>
                  <Icon size={16} />
                  {label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="sidebar__footer">
          <span className="sidebar__avatar" aria-hidden="true">
            {(session.actorId || '?').slice(0, 1).toUpperCase()}
          </span>
          <div>
            <strong title={session.actorId}>{session.actorId}</strong>
            <small data-testid="session-label" title={`${session.tenantId} · ${session.actorId}`}>
              {session.tenantId}
            </small>
          </div>
          <span className="sidebar__tenant">当前租户</span>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span className={`service-status ${serviceOnline === false ? 'is-offline' : ''}`}>
            <i />
            {serviceOnline === null ? '正在检查服务' : serviceOnline ? '服务正常' : '服务未连接'}
          </span>
          <button type="button" className="topbar__icon" aria-label="通知"><IconBell size={16} /></button>
          <ToolsLauncher />
          <UpdateBadge />
        </header>
        <main className="main" data-testid="main">
          <Routes>
            <Route path="/" element={<AssistantPage home />} />
            <Route path="/assistant" element={<AssistantPage />} />
            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/approvals" element={<ApprovalsPage />} />
            <Route path="/telesales" element={<TelesalesPage />} />
            <Route path="/anomalies" element={<AnomaliesPage />} />
            <Route path="/anomalies/:id" element={<AnomalyDetailPage />} />
            <Route path="/automations" element={<AutomationsPage />} />
            <Route path="/triggers" element={<TriggersPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/knowledge" element={<KnowledgePage />} />
            <Route path="/integrations" element={<IntegrationsPage />} />
            <Route path="/resources" element={<ResourcesPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

export function App(): JSX.Element {
  const session = useSessionStore((state) => state.session);
  const initialized = useSessionStore((state) => state.initialized);
  const refresh = useSessionStore((state) => state.refresh);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!initialized) {
    return (
      <div className="boot" data-testid="boot">
        <span className="spinner" aria-hidden="true" />
        {t('app.boot.loading')}
      </div>
    );
  }

  if (!session.hasApiKey) {
    return (
      <div className="boot" data-testid="need-credentials">
        <SettingsPage embedded />
      </div>
    );
  }

  return (
    <BrowserWorkspaceProvider>
      <DocumentPreviewProvider>
        <AssistantProvider>
          <Shell session={session} />
        </AssistantProvider>
      </DocumentPreviewProvider>
    </BrowserWorkspaceProvider>
  );
}
