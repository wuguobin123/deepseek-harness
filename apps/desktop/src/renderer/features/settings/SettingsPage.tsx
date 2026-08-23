import React from 'react';
import { useSessionStore } from '../../stores/session';
import { useAppUpdateStore } from '../../stores/app-update';
import { t } from '../../i18n';
import { workbenchApi } from '../../api';
import {
  IconApproval,
  IconDownload,
  IconGear,
  IconGlobe,
  IconRobot
} from '../../components/icons';

/** 「关于」小区块：当前版本 + 手动检查更新（复用 app-update store）。 */
function AboutCard(): JSX.Element {
  const updateState = useAppUpdateStore((s) => s.state);
  const checking = useAppUpdateStore((s) => s.checking);
  const initialize = useAppUpdateStore((s) => s.initialize);
  const check = useAppUpdateStore((s) => s.check);

  React.useEffect(() => {
    void initialize();
  }, [initialize]);

  const statusText = checking
    ? '正在检查…'
    : updateState?.status === 'available'
      ? `发现新版本 ${updateState.latestVersion ?? ''}`
      : updateState?.status === 'up-to-date'
        ? '已是最新版本'
        : updateState?.status === 'error'
          ? `检查失败：${updateState.error ?? '未知错误'}`
          : '';

  return (
    <section className="settings-card settings-card--compact" id="settings-about" role="tabpanel" data-testid="settings-about">
      <header className="settings-card__header"><span className="settings-card__icon"><IconDownload size={17} /></span><div><h3>关于</h3><p>客户端版本与更新。</p></div></header>
      <p className="settings-card__body">
        当前版本 <strong>{updateState?.currentVersion ?? '—'}</strong>
        {statusText ? <span className="muted">（{statusText}）</span> : null}
      </p>
      <button type="button" className="btn btn--ghost" disabled={checking} onClick={() => void check()} data-testid="about-check-update">
        {checking ? '正在检查…' : '检查更新'}
      </button>
    </section>
  );
}

interface Props {
  embedded?: boolean;
}

type SettingsSection = 'settings-connection' | 'settings-models' | 'settings-account';

// 注册/登录默认连接的服务地址（主进程 session.baseUrl 缺省时的兜底）。
// 开发 vs 生产通过 Vite 构建模式切换：见 apps/desktop/.env.development 与 .env.production。
const DEFAULT_SERVICE_URL =
  (import.meta.env.VITE_DEFAULT_SERVICE_URL as string | undefined) ||
  'http://127.0.0.1:8000';

export function SettingsPage({ embedded = false }: Props): JSX.Element {
  const session = useSessionStore((s) => s.session);
  const update = useSessionStore((s) => s.update);
  const authenticate = useSessionStore((s) => s.authenticate);
  const logout = useSessionStore((s) => s.logout);
  const error = useSessionStore((s) => s.error);

  const [tenantId, setTenantId] = React.useState(
    () => session.tenantId
  );
  const [actorId, setActorId] = React.useState(
    () => session.actorId
  );
  const [baseUrl, setBaseUrl] = React.useState(
    () => session.baseUrl
  );
  const [apiKey, setApiKey] = React.useState(
    () => ''
  );
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [messageKind, setMessageKind] = React.useState<'success' | 'error'>('success');
  const [models, setModels] = React.useState<Array<Record<string, unknown>>>([]);
  const [wallet, setWallet] = React.useState<Record<string, unknown> | null>(null);
  const [usage, setUsage] = React.useState<{ summary?: Array<Record<string, unknown>>; events?: Array<Record<string, unknown>> } | null>(null);
  const [modelDraft, setModelDraft] = React.useState({ provider: 'openai_compatible', displayName: '', baseUrl: '', model: '', apiKey: '' });
  const [embeddingConfig, setEmbeddingConfig] = React.useState<Record<string, unknown> | null>(null);
  const [embeddingSource, setEmbeddingSource] = React.useState('');
  const [embeddingDraft, setEmbeddingDraft] = React.useState({ displayName: '', baseUrl: '', model: '', apiKey: '', dimensions: '1024', batchSize: '16', endpointPath: '/embeddings', queryInstruction: '' });
  const [authMode, setAuthMode] = React.useState<'signup' | 'login'>('signup');
  const [showAdvanced, setShowAdvanced] = React.useState(false);
  const [account, setAccount] = React.useState({ displayName: '', email: '', password: '', verificationCode: '' });
  const [codeCooldown, setCodeCooldown] = React.useState(0);
  const [codeSending, setCodeSending] = React.useState(false);
  const [codeMessage, setCodeMessage] = React.useState<string | null>(null);
  const [codeMessageKind, setCodeMessageKind] = React.useState<'success' | 'error'>('success');
  const [activeSection, setActiveSection] = React.useState<SettingsSection>('settings-connection');

  React.useEffect(() => {
    setTenantId(session.tenantId);
    setActorId(session.actorId);
    setBaseUrl(session.baseUrl);
    setApiKey('');
  }, [session]);

  React.useEffect(() => {
    if (codeCooldown <= 0) return;
    const timer = window.setInterval(() => {
      setCodeCooldown((current) => (current > 0 ? current - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [codeCooldown]);

  const loadModels = React.useCallback(async () => {
    if (embedded || !session.hasApiKey) return;
    const response = await workbenchApi.request({ method: 'GET', path: '/api/model-accounts' });
    if (response.status < 400) {
      const body = response.body as { profiles?: Array<Record<string, unknown>>; wallet?: Record<string, unknown> };
      setModels(body.profiles ?? []); setWallet(body.wallet ?? null);
    }
  }, [embedded, session.hasApiKey]);
  React.useEffect(() => { void loadModels(); }, [loadModels]);

  const loadUsage = React.useCallback(async () => {
    if (embedded || !session.hasApiKey) return;
    const response = await workbenchApi.request({ method: 'GET', path: '/api/model-accounts/usage' });
    if (response.status < 400) {
      const body = response.body as { summary?: Array<Record<string, unknown>>; events?: Array<Record<string, unknown>> };
      setUsage({ summary: body.summary ?? [], events: body.events ?? [] });
    }
  }, [embedded, session.hasApiKey]);
  React.useEffect(() => { void loadUsage(); }, [loadUsage]);

  const loadEmbeddingConfig = React.useCallback(async () => {
    if (embedded || !session.hasApiKey) return;
    const response = await workbenchApi.request({ method: 'GET', path: '/api/knowledge/embedding-config' });
    if (response.status >= 400) return;
    const body = response.body as { config?: Record<string, unknown>; source?: string };
    setEmbeddingConfig(body.config ?? null); setEmbeddingSource(body.source ?? '');
  }, [embedded, session.hasApiKey]);
  React.useEffect(() => { void loadEmbeddingConfig(); }, [loadEmbeddingConfig]);

  async function saveModel(event: React.FormEvent): Promise<void> {
    event.preventDefault(); setBusy(true); setMessage(null);
    const response = await workbenchApi.request({ method: 'POST', path: '/api/model-accounts/byok', body: {
      provider: modelDraft.provider, display_name: modelDraft.displayName, base_url: modelDraft.baseUrl,
      model: modelDraft.model, api_key: modelDraft.apiKey
    }});
    setBusy(false);
    if (response.status >= 400) { setMessageKind('error'); setMessage(`模型保存失败：${JSON.stringify(response.body)}`); return; }
    setModelDraft({ ...modelDraft, displayName: '', baseUrl: '', model: '', apiKey: '' });
    setMessageKind('success'); setMessage('自定义模型已加密保存并设为当前模型'); await loadModels();
  }

  async function activateModel(profileId: string): Promise<void> {
    const response = await workbenchApi.request({ method: 'POST', path: `/api/model-accounts/${encodeURIComponent(profileId)}/activate` });
    if (response.status >= 400) { setMessageKind('error'); setMessage('切换模型失败'); } else { setMessageKind('success'); setMessage('模型已切换'); await loadModels(); }
  }

  async function saveEmbeddingConfig(event: React.FormEvent): Promise<void> {
    event.preventDefault(); setBusy(true); setMessage(null);
    const response = await workbenchApi.request({ method: 'PUT', path: '/api/knowledge/embedding-config', body: {
      display_name: embeddingDraft.displayName, base_url: embeddingDraft.baseUrl, model: embeddingDraft.model,
      api_key: embeddingDraft.apiKey || undefined, dimensions: Number(embeddingDraft.dimensions),
      batch_size: Number(embeddingDraft.batchSize), endpoint_path: embeddingDraft.endpointPath,
      query_instruction: embeddingDraft.queryInstruction
    }});
    setBusy(false);
    if (response.status >= 400) { setMessageKind('error'); setMessage(`向量模型保存失败：${JSON.stringify(response.body)}`); return; }
    const body = response.body as { requiresReindex?: boolean };
    setEmbeddingDraft({ ...embeddingDraft, apiKey: '' });
    setMessageKind('success');
    setMessage(body.requiresReindex ? '向量模型已保存。已有文档需要重建索引后才能使用新向量空间。' : '向量模型已保存，后续知识导入和检索将使用该模型。');
    await loadEmbeddingConfig();
  }

  async function resetEmbeddingConfig(): Promise<void> {
    const response = await workbenchApi.request({ method: 'DELETE', path: '/api/knowledge/embedding-config' });
    if (response.status >= 400) { setMessageKind('error'); setMessage('恢复服务端默认向量模型失败'); return; }
    setMessageKind('success'); setMessage('已恢复服务端默认向量模型。'); await loadEmbeddingConfig();
  }

  async function handleSave(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    await update({
      tenantId: tenantId || undefined,
      actorId: actorId || undefined,
      baseUrl: baseUrl || undefined,
      apiKey: apiKey || undefined
    });
    const updateError = useSessionStore.getState().error;
    setBusy(false);
    if (updateError) {
      setMessage(null);
    } else {
      setMessageKind('success');
      setMessage(t('settings.saved'));
      setApiKey('');
    }
  }

  async function handleSendCode(): Promise<void> {
    if (codeSending || codeCooldown > 0 || !account.email) return;
    setCodeSending(true);
    setCodeMessage(null);
    const result = await useSessionStore.getState().sendVerificationCode({
      baseUrl: baseUrl || DEFAULT_SERVICE_URL,
      email: account.email
    });
    setCodeSending(false);
    if (result.ok) {
      setCodeMessageKind('success');
      setCodeMessage(`验证码已发送至 ${account.email}（${Math.round(result.expiresInSeconds / 60)} 分钟内有效）`);
      setCodeCooldown(result.retryAfterSeconds);
    } else {
      setCodeMessageKind('error');
      setCodeMessage(useSessionStore.getState().error ?? '验证码发送失败');
      if (result.retryAfterSeconds > 0) {
        setCodeCooldown(result.retryAfterSeconds);
      }
    }
  }

  async function handleAuthentication(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    await authenticate({
      mode: authMode,
      baseUrl: baseUrl || DEFAULT_SERVICE_URL,
      email: account.email,
      password: account.password,
      ...(authMode === 'signup' ? { displayName: account.displayName } : {}),
      ...(authMode === 'signup' && account.verificationCode
        ? { verificationCode: account.verificationCode }
        : {})
    });
    setBusy(false);
  }

  function goToSection(sectionId: SettingsSection): void {
    setActiveSection(sectionId);
  }

  if (embedded && !showAdvanced) {
    return (
      <section className="onboarding" data-testid="account-onboarding">
        <div className="onboarding__card">
          <div className="onboarding__brand"><span aria-hidden="true">✦</span> 小薇办公助手</div>
          <h1>{authMode === 'signup' ? '创建你的办公空间' : '欢迎回来'}</h1>
          <p className="muted">生成带设计的演示文稿（HTML/PPTX）、解析 Word/Excel、连接业务系统并运行自动化流程。</p>
          <div className="segmented" role="tablist" aria-label="账号操作">
            <button type="button" className={authMode === 'signup' ? 'active' : ''} onClick={() => setAuthMode('signup')}>注册</button>
            <button type="button" className={authMode === 'login' ? 'active' : ''} onClick={() => setAuthMode('login')}>登录</button>
          </div>
          {error ? <p className="err" data-testid="account-auth-error">{error}</p> : null}
          <form className="form" onSubmit={(event) => void handleAuthentication(event)}>
            {authMode === 'signup' ? <label>姓名<input required value={account.displayName} onChange={(event) => setAccount({...account, displayName: event.target.value})} autoComplete="name" data-testid="account-display-name" /></label> : null}
            <label>邮箱<input required type="email" value={account.email} onChange={(event) => setAccount({...account, email: event.target.value})} autoComplete="email" data-testid="account-email" /></label>
            {authMode === 'signup' ? (
              <>
                <label className="form-row">
                  <span>验证码</span>
                  <input
                    required
                    inputMode="numeric"
                    pattern="\d{6}"
                    maxLength={6}
                    value={account.verificationCode}
                    onChange={(event) => setAccount({ ...account, verificationCode: event.target.value.replace(/\D/g, '') })}
                    placeholder="6 位数字"
                    autoComplete="one-time-code"
                    data-testid="account-verification-code"
                  />
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={codeSending || codeCooldown > 0 || !account.email}
                    onClick={() => void handleSendCode()}
                    data-testid="account-send-code"
                  >
                    {codeSending ? '发送中…' : codeCooldown > 0 ? `${codeCooldown}s 后重发` : '发送验证码'}
                  </button>
                </label>
                {codeMessage ? <p className={codeMessageKind === 'error' ? 'err' : 'muted'} data-testid="account-code-message">{codeMessage}</p> : null}
              </>
            ) : null}
            <label>密码<input required minLength={8} type="password" value={account.password} onChange={(event) => setAccount({...account, password: event.target.value})} autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'} data-testid="account-password" /></label>
            <button type="submit" className="btn btn--primary btn--wide" disabled={busy} data-testid="account-submit">{busy ? '正在连接…' : authMode === 'signup' ? '创建空间并领取 ¥20 额度' : '登录'}</button>
          </form>
          <button type="button" className="link-button" onClick={() => setShowAdvanced(true)} data-testid="account-advanced">使用本地开发服务或已有 API Key</button>
          <small className="muted">平台模型额度由服务端管理；你也可以登录后配置自己的 API Key。</small>
        </div>
      </section>
    );
  }

  return (
    <section className="page page--settings" data-testid="settings-page">
      <header className="page__header">
        <div>
          <h2>{embedded ? '连接工作台后端' : t('settings.title')}</h2>
          <p className="muted">{t('settings.subtitle')}</p>
        </div>
        {!embedded ? (
          <span className={`settings-status ${session.hasApiKey ? 'is-connected' : ''}`}>
            <i aria-hidden="true" />
            {session.hasApiKey ? '已连接' : '未连接'}
          </span>
        ) : null}
      </header>
      {embedded && showAdvanced ? <button type="button" className="link-button" onClick={() => setShowAdvanced(false)}>返回账号登录</button> : null}
      {error && <p className="err" data-testid="settings-error">{t('settings.error.save')}：{error}</p>}
      {message && <p className={`settings-notice is-${messageKind}`} data-testid="settings-message">{message}</p>}

      <div className={`settings-layout ${embedded ? 'is-embedded' : ''}`}>
        {!embedded ? (
          <nav className="settings-nav" aria-label="设置分区" role="tablist" aria-orientation="vertical">
            <button type="button" role="tab" aria-selected={activeSection === 'settings-connection'} aria-controls="settings-connection" data-testid="settings-tab-connection" className={activeSection === 'settings-connection' ? 'is-active' : ''} onClick={() => goToSection('settings-connection')}><IconGlobe size={15} />连接与身份</button>
            <button type="button" role="tab" aria-selected={activeSection === 'settings-models'} aria-controls="settings-models" data-testid="settings-tab-models" className={activeSection === 'settings-models' ? 'is-active' : ''} onClick={() => goToSection('settings-models')}><IconRobot size={15} />模型与额度</button>
            <button type="button" role="tab" aria-selected={activeSection === 'settings-account'} aria-controls="settings-account" data-testid="settings-tab-account" className={activeSection === 'settings-account' ? 'is-active' : ''} onClick={() => goToSection('settings-account')}><IconApproval size={15} />账号</button>
          </nav>
        ) : null}

        <div className="settings-content">
          {embedded || activeSection === 'settings-connection' ? <form className="settings-card settings-connection" id="settings-connection" role="tabpanel" onSubmit={handleSave} data-testid="settings-form">
            <header className="settings-card__header">
              <span className="settings-card__icon"><IconGlobe size={17} /></span>
              <div><h3>连接与身份</h3><p>配置服务端连接以及当前工作空间身份。</p></div>
            </header>
            <div className="settings-fields">
              <label className="settings-field settings-field--wide">
                <span>{t('settings.baseUrl')}</span>
                <input type="url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} data-testid="settings-base-url" placeholder={t('settings.placeholder.baseUrl')} required />
              </label>
              <label className="settings-field settings-field--wide">
                <span>{t('settings.apiKey')} <small>加密保存在本机</small></span>
                <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={session.hasApiKey ? '••••••' : t('settings.placeholder.apiKey')} data-testid="settings-api-key" autoComplete="off" />
              </label>
              <label className="settings-field">
                <span>{t('settings.tenantId')}</span>
                <input type="text" value={tenantId} onChange={(e) => setTenantId(e.target.value)} data-testid="settings-tenant" placeholder={t('settings.placeholder.tenantId')} required />
              </label>
              <label className="settings-field">
                <span>{t('settings.actorId')}</span>
                <input type="text" value={actorId} onChange={(e) => setActorId(e.target.value)} data-testid="settings-actor" placeholder={t('settings.placeholder.actorId')} required />
              </label>
            </div>
            <footer className="settings-card__actions">
              <button type="submit" className="btn btn--primary" disabled={busy} data-testid="settings-save" title={t('common.save')}>{busy ? t('settings.testing') : t('settings.saveAndConnect')}</button>
            </footer>
          </form> : null}

          {!embedded && activeSection === 'settings-models' ? <section className="settings-card" id="settings-models" role="tabpanel" data-testid="model-accounts">
            <header className="settings-card__header settings-card__header--split">
              <span className="settings-card__icon"><IconRobot size={17} /></span>
              <div><h3>模型与额度</h3><p>选择默认模型，或使用自己的供应商密钥。</p></div>
              {wallet ? <div className="settings-balance"><small>平台余额</small><strong>¥{Number(wallet.balanceCny ?? 0).toFixed(2)}</strong>{Number(wallet.welcomeRemainingCny ?? 0) <= 0 ? <small>每日额度 ¥{Number(wallet.dailyRemainingCny ?? 0).toFixed(2)}（次日重置）</small> : null}</div> : null}
            </header>
            <div className="settings-model-list">
              {models.map((item) => <article key={String(item.profileId)} className={item.active ? 'is-active' : ''}>
                <span className="settings-model-logo"><IconRobot size={16} /></span>
                <div><strong>{String(item.displayName ?? item.model)}</strong><p>{String(item.provider)} · {String(item.model)}</p>{item.description ? <p>{String(item.description)}</p> : null}{item.source !== 'byok' && (Number(item.inputPrice ?? 0) > 0 || Number(item.outputPrice ?? 0) > 0) ? <p>¥{Number(item.inputPrice ?? 0)}/M 输入 · ¥{Number(item.outputPrice ?? 0)}/M 输出</p> : null}</div>
                <small>{item.source === 'byok' ? '自带 API Key' : '平台额度'}</small>
                <span className={`badge ${item.active ? 'badge--enabled' : ''}`}>{item.active ? '当前' : '可用'}</span>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => void activateModel(String(item.profileId))}>使用</button>
              </article>)}
            </div>
            <details className="settings-byok">
              <summary><span><IconGear size={15} />添加自己的模型（BYOK）</span><small>高级设置</small></summary>
              <form className="settings-byok__form" onSubmit={(event) => void saveModel(event)}>
                <label className="settings-field"><span>协议</span><select value={modelDraft.provider} onChange={(e) => setModelDraft({...modelDraft,provider:e.target.value})}><option value="openai_compatible">OpenAI Compatible</option><option value="anthropic_compatible">Anthropic Compatible</option></select></label>
                <label className="settings-field"><span>名称</span><input required value={modelDraft.displayName} onChange={(e) => setModelDraft({...modelDraft,displayName:e.target.value})} placeholder="例如：我的 DeepSeek" /></label>
                <label className="settings-field settings-field--wide"><span>Base URL</span><input required type="url" value={modelDraft.baseUrl} onChange={(e) => setModelDraft({...modelDraft,baseUrl:e.target.value})} placeholder="https://api.example.com/v1" /></label>
                <label className="settings-field"><span>模型 ID</span><input required value={modelDraft.model} onChange={(e) => setModelDraft({...modelDraft,model:e.target.value})} /></label>
                <label className="settings-field"><span>API Key</span><input required type="password" autoComplete="off" value={modelDraft.apiKey} onChange={(e) => setModelDraft({...modelDraft,apiKey:e.target.value})} /></label>
                <button type="submit" className="btn btn--primary" disabled={busy}>保存并使用</button>
              </form>
            </details>
            <details className="settings-byok" data-testid="knowledge-embedding-config">
              <summary><span><IconGear size={15} />知识库向量模型</span><small>{embeddingSource === 'tenant_custom' ? '当前为自定义模型' : '使用服务端默认'}</small></summary>
              <p className="muted">用于知识文档索引与检索的同一向量空间。API Key 仅加密保存到服务端，不会再次显示。切换模型或维度后，请重建已有文档的索引。</p>
              {embeddingConfig ? <p className="muted">当前：{String(embeddingConfig.displayName ?? embeddingConfig.model ?? '未配置')} · {String(embeddingConfig.dimensions ?? '-')} 维</p> : null}
              <form className="settings-byok__form" onSubmit={(event) => void saveEmbeddingConfig(event)}>
                <label className="settings-field"><span>名称</span><input required value={embeddingDraft.displayName} onChange={(e) => setEmbeddingDraft({...embeddingDraft,displayName:e.target.value})} placeholder="例如：我的 BGE-M3" /></label>
                <label className="settings-field settings-field--wide"><span>Base URL</span><input required type="url" value={embeddingDraft.baseUrl} onChange={(e) => setEmbeddingDraft({...embeddingDraft,baseUrl:e.target.value})} placeholder="https://api.example.com/v1" /></label>
                <label className="settings-field"><span>模型 ID</span><input required value={embeddingDraft.model} onChange={(e) => setEmbeddingDraft({...embeddingDraft,model:e.target.value})} placeholder="bge-m3" /></label>
                <label className="settings-field"><span>API Key</span><input required={!Boolean(embeddingConfig?.hasApiKey)} type="password" autoComplete="off" value={embeddingDraft.apiKey} onChange={(e) => setEmbeddingDraft({...embeddingDraft,apiKey:e.target.value})} placeholder={embeddingConfig?.hasApiKey ? '保持原密钥' : ''} /></label>
                <label className="settings-field"><span>向量维度</span><input required type="number" min="256" max="8192" value={embeddingDraft.dimensions} onChange={(e) => setEmbeddingDraft({...embeddingDraft,dimensions:e.target.value})} /></label>
                <label className="settings-field"><span>批量大小</span><input required type="number" min="1" max="256" value={embeddingDraft.batchSize} onChange={(e) => setEmbeddingDraft({...embeddingDraft,batchSize:e.target.value})} /></label>
                <label className="settings-field"><span>Endpoint Path</span><input required value={embeddingDraft.endpointPath} onChange={(e) => setEmbeddingDraft({...embeddingDraft,endpointPath:e.target.value})} /></label>
                <label className="settings-field settings-field--wide"><span>查询指令（可选）</span><input value={embeddingDraft.queryInstruction} onChange={(e) => setEmbeddingDraft({...embeddingDraft,queryInstruction:e.target.value})} placeholder="query: " /></label>
                <button type="submit" className="btn btn--primary" disabled={busy}>保存并使用</button>
                {embeddingSource === 'tenant_custom' ? <button type="button" className="btn btn--ghost" onClick={() => void resetEmbeddingConfig()}>恢复默认</button> : null}
              </form>
            </details>
            {usage ? <details className="settings-byok" data-testid="model-usage" open>
              <summary><span><IconGear size={15} />用量明细</span><small>按模型汇总与最近调用</small></summary>
              <div className="settings-usage">
                {(usage.summary ?? []).length > 0 ? <table className="settings-usage__table">
                  <thead><tr><th>模型</th><th>调用</th><th>输入 token</th><th>输出 token</th><th>费用</th></tr></thead>
                  <tbody>
                    {(usage.summary ?? []).map((item, index) => <tr key={index}>
                      <td>{String(item.model ?? item.profileId ?? '-')}</td>
                      <td>{Number(item.calls ?? 0)}</td>
                      <td>{Number(item.inputTokens ?? 0)}</td>
                      <td>{Number(item.outputTokens ?? 0)}</td>
                      <td>¥{Number(item.costCny ?? 0).toFixed(4)}</td>
                    </tr>)}
                  </tbody>
                </table> : <p className="muted">暂无调用记录。</p>}
                {(usage.events ?? []).length > 0 ? <ol className="settings-usage__events">
                  {(usage.events ?? []).slice(0, 20).map((item, index) => <li key={index}>
                    <span>{String(item.createdAt ?? '').slice(0, 19).replace('T', ' ')}</span>
                    <span>{String(item.operation ?? '-')}</span>
                    <span>{Number(item.inputTokens ?? 0)}+{Number(item.outputTokens ?? 0)} tok</span>
                    <span>¥{Number(item.costMicros ?? 0) / 1_000_000}</span>
                  </li>)}
                </ol> : null}
              </div>
            </details> : null}
          </section> : null}

          {!embedded && activeSection === 'settings-account' ? (
            <section className="settings-card settings-card--compact" id="settings-account" role="tabpanel">
              <header className="settings-card__header"><span className="settings-card__icon"><IconApproval size={17} /></span><div><h3>账号</h3><p>管理本机登录状态。</p></div></header>
              <p className="settings-card__body">退出后会清除本机安全存储中的访问令牌，不会删除云端文件和工作流。</p>
              <button type="button" className="btn btn--danger" onClick={() => void logout()} data-testid="account-logout">退出登录</button>
            </section>
          ) : null}

          {!embedded && activeSection === 'settings-account' ? <AboutCard /> : null}

        </div>
      </div>
    </section>
  );
}
