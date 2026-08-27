/**
 * Settings page.
 *
 * Owns the dsh-ops baseUrl and surfaces a single "Probe backend" button that
 * hits `host.describe` to confirm the trust fence accepts requests and to
 * list the model's the backend exposes. The baseUrl persists through
 * `useSessionStore.updateBaseUrl` (which round-trips through the IPC bridge
 * and the credential-store).
 */
import React from 'react'
import { useSessionStore } from '../../stores/session'
import * as api from '../../api'

export function SettingsPage(): React.JSX.Element {
  const session = useSessionStore(state => state.session)
  const updateBaseUrl = useSessionStore(state => state.updateBaseUrl)
  const environment = session.environment
  const refresh = useSessionStore(state => state.refresh)

  const [draft, setDraft] = React.useState<string>(session.baseUrl)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [info, setInfo] = React.useState<api.HostDescribe | null>(null)

  React.useEffect(() => {
    setDraft(session.baseUrl)
  }, [session.baseUrl])

  const onSave = React.useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await updateBaseUrl(draft.trim(), session.environment)
      if (!result.ok) {
        setError(result.error ?? '保存失败')
        return
      }
      await refresh()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }, [draft, refresh, updateBaseUrl])

  const onProbe = React.useCallback(async () => {
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      const described = await api.host.describe()
      setInfo(described)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }, [])

  return (
    <section className="page page-settings" data-testid="page-settings">
      <header className="page-settings__header">
        <h1>设置</h1>
      </header>
      <div className="settings-card" data-testid="settings-baseurl">
        <h2>执行环境</h2>
        <p className="settings-card__hint">本机环境直接读写你选择的目录；云端环境使用账号私有副本。</p>
        <select aria-label="执行环境" value={environment} onChange={(event) => { void updateBaseUrl(session.baseUrl, event.target.value as 'local' | 'cloud') }}>
          <option value="local">本机（默认）</option>
          <option value="cloud">云端</option>
        </select>
        <h2>后端地址</h2>
        <p className="settings-card__hint">
          指向 dsh-ops 的入口（loopback 或经 nginx 暴露的公网入口）。
        </p>
        <label htmlFor="settings-baseurl-input">服务端地址</label>
        <input
          id="settings-baseurl-input"
          type="text"
          value={draft}
          onChange={(e) =>{  setDraft(e.target.value) }}
          placeholder="http://127.0.0.1:18000"
          data-testid="settings-baseurl-input"
        />
        <div className="settings-card__actions">
          <button
            type="button"
            onClick={() => { void onSave() }}
            disabled={busy || draft.trim() === session.baseUrl}
            data-testid="settings-baseurl-save"
          >
            保存
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => { void onProbe() }}
            disabled={busy}
            data-testid="settings-probe"
          >
            探测后端
          </button>
        </div>
        {error ? (
          <p className="settings-card__error" role="alert" data-testid="settings-error">
            {error}
          </p>
        ) : null}
      </div>
      {info ? (
        <div className="settings-card" data-testid="settings-host-info">
          <h2>后端信息</h2>
          <dl className="settings-card__kv">
            <dt>版本</dt>
            <dd>{info.version}</dd>
            <dt>当前工作目录</dt>
            <dd><code>{info.cwd}</code></dd>
            <dt>主目录</dt>
            <dd><code>{info.home}</code></dd>
            <dt>附加会话</dt>
            <dd>{info.attachedSessions}</dd>
            {info.provider && info.model ? (
              <>
                <dt>当前模型</dt>
                <dd><code>{info.provider}/{info.model}</code></dd>
              </>
            ) : null}
            <dt>支持打开本地路径</dt>
            <dd>{info.canOpenPath ? '是' : '否'}</dd>
          </dl>
        </div>
      ) : null}
    </section>
  )
}
