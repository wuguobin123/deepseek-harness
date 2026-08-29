/**
 * Settings → Account section (xiaowei multi-user).
 *
 * Surfaces three things the signed-in user cares about:
 *   - Display name, opaque account id, and sign-out button.
 *   - Wallet balance (`account.wallet.get` → `balanceMicros`, formatted
 *     as CNY through `Intl.NumberFormat('zh-CN')`).
 *   - Three lifetime share-code slots backed by `account.invites`.
 *   - API key list (`account.modelKeys.list`) with created-at / last-used /
 *     revoked timestamps. Revoke is loopback-only on the wire — the
 *     renderer button is disabled with a tooltip explaining why.
 *
 * Reads the userId off `useAuthStore`. The root renderer owns signed-out
 * presentation; this section only reports the brief transition while the
 * authenticated workbench is being disposed.
 */
import React from 'react'
import { useAuthStore } from '../../stores/auth'
import { formatCnyFromMicros, modelKeys, wallet, invites, type ModelKeyView, type WalletView } from '../../api'

const DATE_FMT = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

function formatDate(ms: number | null): string {
  if (ms === null) return '—'
  return DATE_FMT.format(new Date(ms))
}

function invitationStatus(item: Awaited<ReturnType<typeof invites.list>>['items'][number]): {
  label: string
  tone: 'available' | 'used' | 'expired'
} {
  if (item.consumedAt !== null) return { label: '已使用', tone: 'used' }
  if (item.expiresAt <= Date.now()) return { label: '已过期', tone: 'expired' }
  return { label: '未使用', tone: 'available' }
}

function accountErrorMessage(error: unknown): string {
  const candidate = error as Error & { code?: string }
  switch (candidate.code) {
    case 'invitation-limit': return '每个账户最多创建 3 个分享码'
    case 'user-limit': return '当前内测名额已满（100 人），不能再创建分享码'
    case 'unauthenticated': return '登录已失效，请重新登录'
    default: return candidate.message
  }
}

export interface AccountSectionProps {
  // The component pulls live data itself; this prop exists so the parent
  // (SettingsPage or SettingsRoot) can re-mount it after sign-out.
  reloadKey?: string
}

export function AccountSection({ reloadKey }: AccountSectionProps): React.JSX.Element {
  const signedIn = useAuthStore(s => s.state.signedIn)
  const userId = useAuthStore(s => (s.state.signedIn ? s.state.userId : undefined))
  const displayName = useAuthStore(s => (s.state.signedIn ? s.state.displayName : undefined))
  const signOut = useAuthStore(s => s.signOut)

  const [balance, setBalance] = React.useState<WalletView | null>(null)
  const [keys, setKeys] = React.useState<ModelKeyView[] | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [invitationItems, setInvitationItems] = React.useState<Awaited<ReturnType<typeof invites.list>>['items']>([])
  const [newInvitation, setNewInvitation] = React.useState<string | null>(null)
  const [copyError, setCopyError] = React.useState<string | null>(null)
  const [copiedInvitation, setCopiedInvitation] = React.useState<string | null>(null)
  const [rotatingInvitationId, setRotatingInvitationId] = React.useState<string | null>(null)

  const refresh = React.useCallback(async () => {
    if (!userId) {
      setBalance(null)
      setKeys(null)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const [b, k] = await Promise.all([
        wallet.get({ userId }),
        modelKeys.list({ userId }),
      ])
      setBalance(b)
      setKeys(k.items)
      setInvitationItems((await invites.list()).items)
    } catch (err) {
      setError(accountErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }, [userId])

  const copyInvitation = React.useCallback(async (code: string) => {
    setCopyError(null)
    setCopiedInvitation(null)
    try {
      await navigator.clipboard.writeText(code)
      setCopiedInvitation(code)
      return
    } catch { /* Electron file: origins may reject navigator.clipboard. */ }
    const area = document.createElement('textarea')
    try {
      area.value = code
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.append(area)
      area.select()
      if (!document.execCommand('copy')) throw new Error('copy rejected')
      setCopiedInvitation(code)
    } catch {
      setCopyError('复制失败，请手动选择并复制分享码')
    } finally {
      area.remove()
    }
  }, [])

  React.useEffect(() => {
    if (copiedInvitation === null) return
    const timer = window.setTimeout(() => { setCopiedInvitation(null) }, 2_000)
    return () => { window.clearTimeout(timer) }
  }, [copiedInvitation])

  const createInvitation = React.useCallback(async () => {
    setBusy(true)
    setError(null)
    setCopyError(null)
    setCopiedInvitation(null)
    try {
      const value = await invites.create()
      setNewInvitation(value.code)
      await refresh()
    } catch (err) {
      setError(accountErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }, [refresh])

  const rotateInvitation = React.useCallback(async (invitationId: string) => {
    if (!window.confirm('重新生成后，旧分享码会立即失效。确定继续吗？')) return
    setRotatingInvitationId(invitationId)
    setError(null)
    setCopyError(null)
    try {
      const value = await invites.rotate(invitationId)
      setNewInvitation(value.code)
      await refresh()
    } catch (err) {
      setError(accountErrorMessage(err))
    } finally {
      setRotatingInvitationId(null)
    }
  }, [refresh])

  React.useEffect(() => {
    void refresh()
  }, [refresh, reloadKey])

  if (!signedIn || !userId) {
    return (
      <section className="settings-section settings-section--account" data-testid="settings-account-signedout">
        <header className="settings-section__header">
          <h2 className="settings-section__title">账户</h2>
          <p className="settings-section__subtitle">登录已退出，正在返回登录页面…</p>
        </header>
      </section>
    )
  }

  return (
    <section className="settings-section settings-section--account" data-testid="settings-account">
      <header className="settings-section__header">
        <h2 className="settings-section__title">账户</h2>
        <p className="settings-section__subtitle">管理登录身份、MiniMax 额度与 API 密钥。</p>
      </header>
      {error ? (
        <p className="settings-card__error" role="alert" data-testid="settings-account-error">
          {error}
        </p>
      ) : null}

      <div className="settings-card" data-testid="settings-account-identity">
        <h3>身份</h3>
        <dl className="settings-card__kv">
          <dt>显示名</dt>
          <dd>{displayName ?? '—'}</dd>
          <dt>用户编号</dt>
          <dd><code>{userId}</code></dd>
        </dl>
        <div className="settings-card__actions">
          <button
            type="button"
            className="danger"
            onClick={() => { void signOut() }}
            data-testid="settings-account-signout"
          >
            退出登录
          </button>
        </div>
      </div>

      <div className="settings-card" data-testid="settings-account-invites">
        <div className="account-invites__header">
          <div>
            <h3>我的分享码</h3>
            <p className="settings-card__hint">每个账户有 3 个终身名额，已使用和过期的名额也会计入。</p>
          </div>
          <span className="account-invites__quota">已创建 {invitationItems.length} / 3</span>
        </div>
        {newInvitation ? (
          <div className="account-invites__new" data-testid="settings-account-invite-new">
            <div className="account-invites__new-header">
              <strong>新生成的分享码</strong>
              <span>有效期内可随时查看</span>
            </div>
            <div className="account-invites__code-row">
              <code title={newInvitation}>{newInvitation}</code>
              <button
                type="button"
                className={copiedInvitation === newInvitation ? 'is-copied' : undefined}
                onClick={() => { void copyInvitation(newInvitation) }}
              >
                {copiedInvitation === newInvitation ? '已复制' : '复制'}
              </button>
            </div>
            <p>有效期内可随时回来查看并复制。</p>
          </div>
        ) : null}
        {copyError ? <p className="settings-card__error" role="alert">{copyError}</p> : null}
        {invitationItems.length > 0 ? (
          <div className="account-invites__history">
            <h4>已创建的分享码</h4>
            <ul>
              {invitationItems.map((item, index) => {
                const status = invitationStatus(item)
                const code = item.code
                const isLegacyActive = code === null && status.tone === 'available'
                return (
                  <li key={item.invitationId}>
                    <span className="account-invites__index" aria-hidden="true">{index + 1}</span>
                    <div className="account-invites__value">
                      <code title={code ?? item.codeMask}>{code ?? item.codeMask}</code>
                      {isLegacyActive ? <small>旧版分享码无法恢复，可重新生成</small> : null}
                    </div>
                    <div className="account-invites__row-actions">
                      {code !== null ? (
                        <button
                          type="button"
                          className={copiedInvitation === code ? 'is-copied' : undefined}
                          onClick={() => { void copyInvitation(code) }}
                        >
                          {copiedInvitation === code ? '已复制' : '复制'}
                        </button>
                      ) : null}
                      {isLegacyActive ? (
                        <button
                          type="button"
                          disabled={rotatingInvitationId !== null}
                          onClick={() => { void rotateInvitation(item.invitationId) }}
                        >
                          {rotatingInvitationId === item.invitationId ? '生成中…' : '重新生成'}
                        </button>
                      ) : null}
                    </div>
                    <span className={`account-invites__status account-invites__status--${status.tone}`}>
                      {status.label}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        ) : (
          <div className="account-invites__empty">还没有分享码，创建后可发送给你信任的人。</div>
        )}
        <div className="settings-card__actions">
          <button className="primary" type="button" disabled={busy || invitationItems.length >= 3} onClick={() => { void createInvitation() }}>创建分享码</button>
          <button type="button" disabled={busy} onClick={() => { void refresh() }}>刷新</button>
        </div>
      </div>

      <div className="settings-card" data-testid="settings-account-wallet">
        <h3>MiniMax 模型额度</h3>
        <p className="settings-card__hint">
          每个新注册账户自动获赠 20 元平台模型额度。
        </p>
        <dl className="settings-card__kv">
          <dt>当前余额</dt>
          <dd className="settings-card__balance">
            {balance ? formatCnyFromMicros(balance.balanceMicros) : '—'}
          </dd>
          <dt>更新时间</dt>
          <dd>{balance ? formatDate(balance.updatedAt) : '—'}</dd>
        </dl>
        <div className="settings-card__actions">
          <button
            type="button"
            onClick={() => { void refresh() }}
            disabled={busy}
            data-testid="settings-account-wallet-refresh"
          >
            {busy ? '刷新中…' : '刷新'}
          </button>
        </div>
      </div>

      <div className="settings-card" data-testid="settings-account-keys">
        <h3>API 密钥</h3>
        <p className="settings-card__hint">
          注册时自动生成一把。密钥明文仅在创建时显示一次，列表只展示元信息。
        </p>
        {keys === null ? (
          <p className="settings-card__hint">加载中…</p>
        ) : keys.length === 0 ? (
          <p className="settings-card__hint">暂无密钥。</p>
        ) : (
          <table className="settings-card__table" data-testid="settings-account-keys-table">
            <thead>
              <tr>
                <th>标签</th>
                <th>编号</th>
                <th>创建</th>
                <th>最近使用</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {keys.map(k => (
                <tr key={k.keyId} data-testid="settings-account-keys-row">
                  <td>{k.label}</td>
                  <td><code>{k.keyId}</code></td>
                  <td>{formatDate(k.createdAt)}</td>
                  <td>{formatDate(k.lastUsedAt)}</td>
                  <td>
                    {k.revokedAt
                      ? <span className="badge badge--muted">已撤销 {formatDate(k.revokedAt)}</span>
                      : <span className="badge badge--ok">活跃</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  )
}
