import React from 'react';
import {
  IconInbox,
  IconPlug,
  IconRobot,
  IconSearch,
  IconShield
} from '../../components/icons';
import { workbenchApi } from '../../api';

interface CapabilityRow {
  capabilityId: string;
  pluginId?: string;
  name?: string;
  description?: string;
  riskLevel?: string;
  allowedRoles?: string[];
}

interface SkillInstallationRow {
  slug: string;
  skillRef?: string;
  name?: string;
  description?: string;
  version?: string;
  status?: string;
  updatedAt?: number;
  hasRollback?: boolean;
  /** ``workshop`` rows are prompt skills, not install-service records. */
  source?: string;
  managed?: boolean;
  manifest?: {
    permissions?: string[];
    requiredTools?: string[];
    requiredConnectors?: string[];
  };
}

function isManagedSkill(skill: SkillInstallationRow): boolean {
  // Older installation records do not carry either field and remain managed.
  return skill.managed !== false && skill.source !== 'workshop' && skill.source !== 'skill_workshop';
}

function skillSourceLabel(skill: SkillInstallationRow): string {
  if (!isManagedSkill(skill)) return 'Skill Workshop';
  if (skill.source && skill.source !== 'installation') return skill.source;
  return '已安装';
}

function skillStatusLabel(status?: string): string {
  if (status === 'enabled') return '已启用';
  if (status === 'disabled') return '已禁用';
  if (status === 'uninstalled') return '已卸载';
  return status || '可用';
}

interface SkillUpdateInfo {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
}

interface ConnectorRow {
  connectorId: string;
  kind: string;
  displayName: string;
  baseUrl: string;
  authType: string;
  status: string;
  hasCredentials: boolean;
  lastTestedAt?: string | null;
  lastError?: string | null;
}

type IntegrationSection = 'connectors' | 'skills' | 'capabilities';

function connectorStatusLabel(status: string): string {
  if (status === 'connected') return '已连接';
  if (status === 'error') return '异常';
  if (status === 'disabled') return '已停用';
  return '待测试';
}

export function IntegrationsPage(): JSX.Element {
  const [items, setItems] = React.useState<CapabilityRow[]>([]);
  const [skills, setSkills] = React.useState<SkillInstallationRow[]>([]);
  const [updates, setUpdates] = React.useState<Record<string, SkillUpdateInfo>>({});
  const [connectors, setConnectors] = React.useState<ConnectorRow[]>([]);
  const [connectorDraft, setConnectorDraft] = React.useState({
    displayName: '',
    kind: 'rest_api',
    baseUrl: '',
    authType: 'bearer',
    token: '',
    larkAppId: '',
    larkAppSecret: '',
    username: '',
    password: '',
    header: 'X-API-Key',
    readOnlyTools: '',
    allowPrivateNetwork: false
  });
  const [connectorBusy, setConnectorBusy] = React.useState<string | null>(null);
  const [activeSection, setActiveSection] = React.useState<IntegrationSection>('connectors');
  const [showConnectorForm, setShowConnectorForm] = React.useState(false);
  const [capabilityQuery, setCapabilityQuery] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    void Promise.all([
      workbenchApi.request({ method: 'GET', path: '/api/capabilities' }),
      workbenchApi.request({ method: 'GET', path: '/api/skill-installations' }),
      workbenchApi.request({ method: 'GET', path: '/api/connectors' })
    ])
      .then(([capabilityResponse, skillResponse, connectorResponse]) => {
        if (!active) return;
        if (capabilityResponse.status >= 400) {
          throw new Error(`HTTP ${capabilityResponse.status}`);
        }
        if (skillResponse.status >= 400) throw new Error(`HTTP ${skillResponse.status}`);
        if (connectorResponse.status >= 400) throw new Error(`HTTP ${connectorResponse.status}`);
        const body = capabilityResponse.body as { capabilities?: CapabilityRow[] };
        const skillBody = skillResponse.body as { installations?: SkillInstallationRow[] };
        const connectorBody = connectorResponse.body as { connectors?: ConnectorRow[] };
        setItems(body.capabilities ?? []);
        setSkills(skillBody.installations ?? []);
        setConnectors(connectorBody.connectors ?? []);
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function saveConnector(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setConnectorBusy('save');
    const credentials =
      connectorDraft.kind === 'lark'
        ? { app_id: connectorDraft.larkAppId, app_secret: connectorDraft.larkAppSecret }
        : connectorDraft.authType === 'bearer'
        ? { token: connectorDraft.token }
        : connectorDraft.authType === 'api_key'
          ? { api_key: connectorDraft.token, header: connectorDraft.header }
          : connectorDraft.authType === 'basic'
            ? { username: connectorDraft.username, password: connectorDraft.password }
            : undefined;
    const response = await workbenchApi.request({
      method: 'POST',
      path: '/api/connectors',
      body: {
        // lark-cli deliberately resolves this stable ID inside each user's
        // connector namespace.  The server's tenant/actor ownership boundary
        // means this never overwrites another user's connection.
        connector_id: connectorDraft.kind === 'lark' ? 'CONN-LARK-CLI' : undefined,
        kind: connectorDraft.kind,
        display_name: connectorDraft.displayName,
        base_url: connectorDraft.baseUrl,
        auth_type: connectorDraft.kind === 'lark' ? 'api_key' : connectorDraft.authType,
        public_config: {
          allow_private_network: connectorDraft.allowPrivateNetwork,
          health_path: '/',
          read_only_tools: connectorDraft.readOnlyTools
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)
        },
        credentials
      }
    });
    setConnectorBusy(null);
    if (response.status >= 400) {
      setError(`保存连接失败：${JSON.stringify(response.body)}`);
      return;
    }
    const saved = response.body as ConnectorRow;
    setConnectors((current) => [saved, ...current.filter((item) => item.connectorId !== saved.connectorId)]);
    setConnectorDraft((current) => ({
      ...current,
      displayName: '',
      baseUrl: '',
      token: '',
      larkAppId: '',
      larkAppSecret: '',
      username: '',
      password: ''
    }));
    setShowConnectorForm(false);
  }

  async function testConnector(connector: ConnectorRow): Promise<void> {
    setConnectorBusy(connector.connectorId);
    setError(null);
    const response = await workbenchApi.request({
      method: 'POST',
      path: `/api/connectors/${encodeURIComponent(connector.connectorId)}/test`,
      timeoutMs: 30_000
    });
    setConnectorBusy(null);
    if (response.status >= 400) {
      setError(`连接测试失败：${JSON.stringify(response.body)}`);
      return;
    }
    setConnectors((current) =>
      current.map((item) =>
        item.connectorId === connector.connectorId
          ? { ...item, status: 'connected', lastError: null, lastTestedAt: new Date().toISOString() }
          : item
      )
    );
  }

  async function deleteConnector(connector: ConnectorRow): Promise<void> {
    if (!window.confirm(`确定删除连接“${connector.displayName}”？保存的凭据也会删除。`)) return;
    const response = await workbenchApi.request({
      method: 'DELETE',
      path: `/api/connectors/${encodeURIComponent(connector.connectorId)}`
    });
    if (response.status >= 400) {
      setError(`删除连接失败：HTTP ${response.status}`);
      return;
    }
    setConnectors((current) => current.filter((item) => item.connectorId !== connector.connectorId));
  }

  async function setSkillEnabled(skill: SkillInstallationRow, enabled: boolean): Promise<void> {
    setError(null);
    const response = await workbenchApi.request({
      method: 'POST',
      path: `/api/skill-installations/${encodeURIComponent(skill.slug)}/status`,
      body: { enabled }
    });
    if (response.status >= 400) {
      setError(`更新 Skill 失败：HTTP ${response.status}`);
      return;
    }
    const updated = response.body as SkillInstallationRow;
    setSkills((current) =>
      current.map((item) => (item.slug === skill.slug ? updated : item))
    );
  }

  async function uninstallSkill(skill: SkillInstallationRow): Promise<void> {
    if (!window.confirm(`确定卸载 ${skill.slug}？文件会移入本地可恢复区。`)) return;
    setError(null);
    const response = await workbenchApi.request({
      method: 'DELETE',
      path: `/api/skill-installations/${encodeURIComponent(skill.slug)}`
    });
    if (response.status >= 400) {
      setError(`卸载 Skill 失败：HTTP ${response.status}`);
      return;
    }
    const updated = response.body as SkillInstallationRow;
    setSkills((current) =>
      current.map((item) => (item.slug === skill.slug ? updated : item))
    );
  }

  async function checkSkillUpdate(skill: SkillInstallationRow): Promise<void> {
    setError(null);
    const response = await workbenchApi.request({
      method: 'GET',
      path: `/api/skill-installations/${encodeURIComponent(skill.slug)}/update`
    });
    if (response.status >= 400) {
      setError(`检查更新失败：HTTP ${response.status}`);
      return;
    }
    setUpdates((current) => ({
      ...current,
      [skill.slug]: response.body as SkillUpdateInfo
    }));
  }

  async function updateSkill(skill: SkillInstallationRow, version: string): Promise<void> {
    setError(null);
    const response = await workbenchApi.request({
      method: 'POST',
      path: `/api/skill-installations/${encodeURIComponent(skill.slug)}/update`,
      body: { version },
      timeoutMs: 180_000
    });
    if (response.status >= 400) {
      setError(`更新 Skill 失败：HTTP ${response.status}`);
      return;
    }
    const updated = response.body as SkillInstallationRow;
    setSkills((current) =>
      current.map((item) => (item.slug === skill.slug ? updated : item))
    );
    setUpdates((current) => ({
      ...current,
      [skill.slug]: {
        currentVersion: updated.version ?? skill.version ?? 'unknown',
        latestVersion: updated.version ?? skill.version ?? 'unknown',
        updateAvailable: false
      }
    }));
  }

  async function rollbackSkill(skill: SkillInstallationRow): Promise<void> {
    setError(null);
    const response = await workbenchApi.request({
      method: 'POST',
      path: `/api/skill-installations/${encodeURIComponent(skill.slug)}/rollback`
    });
    if (response.status >= 400) {
      setError(`回滚 Skill 失败：HTTP ${response.status}`);
      return;
    }
    const updated = response.body as SkillInstallationRow;
    setSkills((current) =>
      current.map((item) => (item.slug === skill.slug ? updated : item))
    );
    setUpdates((current) => {
      const next = { ...current };
      delete next[skill.slug];
      return next;
    });
  }

  const filteredCapabilities = items.filter((item) => {
    const query = capabilityQuery.trim().toLowerCase();
    if (!query) return true;
    return [item.name, item.description, item.capabilityId, item.pluginId]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
  });

  return (
    <section className="page page--integrations" data-testid="integrations-page">
      <header className="page__header">
        <div>
          <h2>业务系统</h2>
          <p>管理企业连接、个人 Skills 与 AI 可调用能力。</p>
        </div>
        <span className="integration-security"><IconShield size={14} />凭据不会进入模型上下文</span>
      </header>
      {loading ? <p className="status-line"><span className="spinner" />正在加载能力目录…</p> : null}
      {error ? <p className="integrations-notice is-error">{error}</p> : null}

      <div className="integrations-layout">
        <nav className="integrations-tabs" role="tablist" aria-label="业务系统分区" aria-orientation="vertical">
          <button type="button" role="tab" aria-selected={activeSection === 'connectors'} className={activeSection === 'connectors' ? 'is-active' : ''} data-testid="integrations-tab-connectors" onClick={() => setActiveSection('connectors')}><IconPlug size={15} /><span>业务连接</span><small>{connectors.length}</small></button>
          <button type="button" role="tab" aria-selected={activeSection === 'skills'} className={activeSection === 'skills' ? 'is-active' : ''} data-testid="integrations-tab-skills" onClick={() => setActiveSection('skills')}><IconRobot size={15} /><span>我的 Skills</span><small>{skills.length}</small></button>
          <button type="button" role="tab" aria-selected={activeSection === 'capabilities'} className={activeSection === 'capabilities' ? 'is-active' : ''} data-testid="integrations-tab-capabilities" onClick={() => setActiveSection('capabilities')}><IconShield size={15} /><span>能力目录</span><small>{items.length}</small></button>
        </nav>

        <div className="integrations-content">
          {activeSection === 'connectors' ? <section className="integration-card" role="tabpanel" data-testid="business-connectors">
            <header className="integration-card__header">
              <div><h3>业务连接</h3><p>集中管理 CRM、MCP 与协作平台连接。</p></div>
              <button type="button" className="btn btn--primary" data-testid="connector-add" onClick={() => setShowConnectorForm((value) => !value)}>{showConnectorForm ? '收起表单' : '添加连接'}</button>
            </header>
            <div className="integration-safety-note"><IconShield size={15} /><span>凭据加密保存在本机服务；读取操作可自动执行，写操作仍需确认。</span></div>
            {connectors.length ? <div className="connector-grid">
              {connectors.map((connector) => (
                <article className="connector-card" key={connector.connectorId} data-testid={`connector-${connector.connectorId}`}>
                  <div className="connector-card__top">
                    <span className="connector-card__icon"><IconPlug size={17} /></span>
                    <div><strong>{connector.displayName}</strong><p>{connector.baseUrl}</p></div>
                    <span className={`connector-status is-${connector.status}`}><i />{connectorStatusLabel(connector.status)}</span>
                  </div>
                  <dl>
                    <div><dt>类型</dt><dd>{connector.kind}</dd></div>
                    <div><dt>认证</dt><dd>{connector.authType}</dd></div>
                    <div><dt>凭据</dt><dd>{connector.hasCredentials ? '已保存' : '未配置'}</dd></div>
                  </dl>
                  {connector.lastError ? <p className="connector-card__error">{connector.lastError}</p> : null}
                  <footer>
                    <button type="button" className="btn btn--ghost btn--sm" disabled={connectorBusy === connector.connectorId} onClick={() => void testConnector(connector)}>{connectorBusy === connector.connectorId ? '测试中…' : '测试连接'}</button>
                    <button type="button" className="btn btn--danger btn--sm" onClick={() => void deleteConnector(connector)}>删除</button>
                  </footer>
                </article>
              ))}
            </div> : <div className="integration-empty"><IconInbox size={24} /><strong>还没有业务连接</strong><p>添加 CRM、MCP 或协作平台，让 AI 安全读取企业数据。</p></div>}

            {showConnectorForm ? <form className="connector-editor" onSubmit={(event) => void saveConnector(event)} data-testid="connector-form">
              <header><div><h4>添加业务连接</h4><p>只填写当前认证方式所需的信息。</p></div><button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowConnectorForm(false)}>取消</button></header>
              <div className="connector-form-grid">
                <label><span>连接名称</span><input required value={connectorDraft.displayName} onChange={(event) => setConnectorDraft({ ...connectorDraft, displayName: event.target.value })} placeholder="例如：销售 CRM" /></label>
                <label><span>类型</span><select value={connectorDraft.kind} onChange={(event) => setConnectorDraft({ ...connectorDraft, kind: event.target.value })}><option value="rest_api">REST API</option><option value="mcp">MCP Server</option><option value="lark">飞书 / Lark</option><option value="wecom">企业微信</option><option value="dingtalk">钉钉</option></select></label>
                <label className="is-wide"><span>服务地址</span><input required type="url" value={connectorDraft.baseUrl} onChange={(event) => setConnectorDraft({ ...connectorDraft, baseUrl: event.target.value })} placeholder="https://crm.example.com/api" /></label>
                {connectorDraft.kind === 'lark' ? <>
                  <label><span>飞书应用 ID</span><input required aria-label="飞书应用 ID" autoComplete="off" value={connectorDraft.larkAppId} onChange={(event) => setConnectorDraft({ ...connectorDraft, larkAppId: event.target.value })} placeholder="cli_..." /></label>
                  <label><span>飞书应用密钥</span><input required aria-label="飞书应用密钥" type="password" autoComplete="off" value={connectorDraft.larkAppSecret} onChange={(event) => setConnectorDraft({ ...connectorDraft, larkAppSecret: event.target.value })} /></label>
                  <p className="connector-editor__hint is-wide">凭据仅加密保存于当前工作台账号。保存后会先换取短期租户令牌，CLI 容器不会获得应用密钥。</p>
                </> : <>
                  <label><span>认证方式</span><select value={connectorDraft.authType} onChange={(event) => setConnectorDraft({ ...connectorDraft, authType: event.target.value })}><option value="bearer">Bearer Token</option><option value="api_key">API Key</option><option value="basic">用户名密码</option><option value="none">无需认证</option></select></label>
                  {connectorDraft.authType === 'bearer' || connectorDraft.authType === 'api_key' ? <label><span>{connectorDraft.authType === 'bearer' ? 'Token' : 'API Key'}</span><input required type="password" autoComplete="off" value={connectorDraft.token} onChange={(event) => setConnectorDraft({ ...connectorDraft, token: event.target.value })} /></label> : null}
                </>}
                {connectorDraft.authType === 'api_key' ? <label><span>Header 名称</span><input value={connectorDraft.header} onChange={(event) => setConnectorDraft({ ...connectorDraft, header: event.target.value })} /></label> : null}
                {connectorDraft.authType === 'basic' ? <><label><span>用户名</span><input required autoComplete="username" value={connectorDraft.username} onChange={(event) => setConnectorDraft({ ...connectorDraft, username: event.target.value })} /></label><label><span>密码</span><input required type="password" autoComplete="new-password" value={connectorDraft.password} onChange={(event) => setConnectorDraft({ ...connectorDraft, password: event.target.value })} /></label></> : null}
                {connectorDraft.kind === 'mcp' ? <label className="is-wide"><span>允许 Agent 自动调用的只读工具</span><input value={connectorDraft.readOnlyTools} onChange={(event) => setConnectorDraft({ ...connectorDraft, readOnlyTools: event.target.value })} placeholder="例如：crm.search, crm.get_customer" /><small>逗号分隔；未列出的 MCP 工具按写操作处理并需要确认。</small></label> : null}
                <label className="checkbox-row is-wide"><input type="checkbox" checked={connectorDraft.allowPrivateNetwork} onChange={(event) => setConnectorDraft({ ...connectorDraft, allowPrivateNetwork: event.target.checked })} />允许访问本机或内网地址（仅用于可信业务系统）</label>
              </div>
              <footer><button type="submit" className="btn btn--primary" disabled={connectorBusy === 'save'}>{connectorBusy === 'save' ? '正在保存…' : '保存连接'}</button></footer>
            </form> : null}
          </section> : null}

          {activeSection === 'skills' ? <section className="integration-card" role="tabpanel" data-testid="installed-skills">
            <header className="integration-card__header"><div><h3>我的 Skills</h3><p>当前账号可用的 Skills 会显示在这里；已安装 Skill 可在此管理，Workshop Skill 由系统自动提供。</p></div><span className="integration-count">{skills.length} 个</span></header>
            {skills.length === 0 ? <div className="integration-empty"><IconRobot size={24} /><strong>尚未安装个人 Skill</strong><p>在对话中描述所需能力，让助手直接帮你安装。</p></div> : <div className="integration-list">
              {skills.map((skill) => {
                const managed = isManagedSkill(skill);
                const status = skill.status || 'available';
                const dependencies = [
                  ...(skill.manifest?.requiredTools || []),
                  ...(skill.manifest?.requiredConnectors || [])
                ];
                return <article key={skill.slug} data-testid={`skill-${skill.slug}`}>
                <span className="integration-list__icon"><IconRobot size={16} /></span>
                <div><strong>{skill.name || skill.slug}</strong><p>{skill.description || skill.skillRef || '当前账号可用的 Skill'}</p><small>来源 {skillSourceLabel(skill)} · 版本 {skill.version || '内置'}{skill.manifest?.permissions?.length ? ` · 权限 ${skill.manifest.permissions.join('、')}` : ''}{dependencies.length ? ` · 依赖 ${dependencies.join('、')}` : ''}</small></div>
                <span className={`badge badge--${status}`}>{skillStatusLabel(status)}</span>
                {managed && status !== 'uninstalled' ? <div className="integration-list__actions">
                  {updates[skill.slug]?.updateAvailable ? <button type="button" className="btn btn--primary btn--sm" onClick={() => void updateSkill(skill, updates[skill.slug].latestVersion)}>更新到 {updates[skill.slug].latestVersion}</button> : <button type="button" className="btn btn--ghost btn--sm" onClick={() => void checkSkillUpdate(skill)}>检查更新</button>}
                  {skill.hasRollback ? <button type="button" className="btn btn--ghost btn--sm" onClick={() => void rollbackSkill(skill)}>回滚</button> : null}
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => void setSkillEnabled(skill, status !== 'enabled')}>{status === 'enabled' ? '禁用' : '启用'}</button>
                  <button type="button" className="btn btn--danger btn--sm" onClick={() => void uninstallSkill(skill)}>卸载</button>
                </div> : null}
              </article>;
              })}
            </div>}
          </section> : null}

          {activeSection === 'capabilities' ? <section className="integration-card" role="tabpanel" data-testid="capability-catalog">
            <header className="integration-card__header"><div><h3>能力目录</h3><p>查看 AI 当前可以读取和操作的能力及风险等级。</p></div><span className="integration-count">{items.length} 项</span></header>
            <label className="integration-search"><IconSearch size={15} /><input type="search" aria-label="搜索能力" value={capabilityQuery} onChange={(event) => setCapabilityQuery(event.target.value)} placeholder="搜索名称、描述或能力 ID" /><span>{filteredCapabilities.length} 个结果</span></label>
            {!loading && !error && filteredCapabilities.length === 0 ? <div className="integration-empty"><IconInbox size={24} /><strong>没有匹配的业务能力</strong></div> : <div className="integration-list integration-list--capabilities">
              {filteredCapabilities.map((item) => <article key={item.capabilityId}>
                <span className="integration-list__icon"><IconPlug size={16} /></span>
                <div><strong>{item.name || item.capabilityId}</strong><p>{item.description || '企业业务能力'}</p><small>{item.pluginId || 'ServicePilot'} · {item.capabilityId}</small></div>
                <span className={`integration-risk is-${(item.riskLevel || 'controlled').toLowerCase()}`}>{item.riskLevel || '受控'}</span>
              </article>)}
            </div>}
          </section> : null}
        </div>
      </div>
    </section>
  );
}
