/** Desktop account launcher for Settings, with an independent update action. */
import { useEffect, useState } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { SettingsLauncherOwnerProps } from '@deepseek-ai/dsh-client-ui-settings/client'
import { IconDownload } from '../../components/icons'
import type { AppUpdateState } from '../../../shared/contracts'
import { formatCnyFromMicros, update, wallet, type WalletView } from '../../api'
import { AccountSection } from '../account/AccountSection'
import { useAuthStore } from '../../stores/auth'

/** Services required by the desktop account slot registrations. */
export const inject = ['slots']

function avatarChar(displayName: string | null, userId: string | undefined): string {
  const source = (displayName?.trim() || userId?.trim() || '?').replace(/^@/, '')
  return (Array.from(source)[0] ?? '?').toUpperCase()
}

function useWallet(userId: string | undefined): WalletView | null {
  const [balance, setBalance] = useState<WalletView | null>(null)
  useEffect(() => {
    let active = true
    setBalance(null)
    if (!userId) return () => { active = false }
    void wallet.get({ userId }).then((value) => {
      if (active) setBalance(value)
    }).catch(() => {
      if (active) setBalance(null)
    })
    return () => { active = false }
  }, [userId])
  return balance
}

function useAppUpdate(): AppUpdateState | null {
  const [state, setState] = useState<AppUpdateState | null>(null)
  useEffect(() => {
    let active = true
    let unsubscribe: (() => void) | undefined
    void Promise.all([
      update.getState().then((value) => { if (active) setState(value) }),
      update.subscribe((value) => { if (active) setState(value) }).then((off) => { unsubscribe = off }),
    ])
    return () => {
      active = false
      unsubscribe?.()
    }
  }, [])
  return state
}

/**
 * Render the account launcher and its right-aligned update action.
 * @param props - Settings launcher state and actions supplied by the shell.
 * @returns The account footer, or the settings and update actions while signed out.
 */
export function UserMenu({ wide, isOpen, openSettings, openSection }: SettingsLauncherOwnerProps): React.JSX.Element {
  const signedIn = useAuthStore(state => state.state.signedIn)
  const displayName = useAuthStore(state => state.state.signedIn ? state.state.displayName : null)
  const userId = useAuthStore(state => state.state.signedIn ? state.state.userId : undefined)
  const balance = useWallet(userId)
  const appUpdate = useAppUpdate()
  const [updateError, setUpdateError] = useState<string | null>(null)
  const [updateStatus, setUpdateStatus] = useState<string | null>(null)
  const available = appUpdate?.status === 'available'
  const checking = appUpdate?.status === 'checking'

  async function handleUpdate(): Promise<void> {
    setUpdateError(null)
    setUpdateStatus(null)
    try {
      if (!available) {
        const result = await update.check()
        if (result.status === 'up-to-date') {
          setUpdateStatus(`已是最新版本 ${result.currentVersion}`)
        } else if (result.status === 'available') {
          setUpdateStatus(`发现新版本 ${result.latestVersion ?? ''}，请再次点击更新`)
        } else if (result.status === 'error') {
          setUpdateError(result.error ?? '检查更新失败')
        }
        return
      }
      const result = await update.openDownload()
      if (result.ok) {
        setUpdateStatus('更新安装程序已启动')
      } else {
        setUpdateError(result.error ?? '无法启动更新')
      }
    } catch (error) {
      setUpdateError(error instanceof Error ? error.message : String(error))
    }
  }

  const updateAction = (
    <button
      type="button"
      className={`user-menu__update ${available ? 'has-update' : ''}`}
      aria-label={available ? `客户端有新版本 ${appUpdate.latestVersion ?? ''}` : '检查客户端更新'}
      title={checking ? '正在检查更新…' : available ? `新版本 ${appUpdate.latestVersion ?? ''}` : '检查客户端更新'}
      aria-busy={checking}
      disabled={checking}
      onClick={() => { void handleUpdate() }}
      data-testid="user-menu-update"
    >
      <IconDownload className="user-menu__update-icon" size={14} />
    </button>
  )

  if (!signedIn || !userId) {
    return (
      <div className={`user-menu user-menu--guest ${wide ? 'is-wide' : 'is-rail'}`} data-testid="user-menu-guest">
        <div className="user-menu__row">
          <button
            type="button"
            className={`user-menu__guest-settings ${wide ? 'is-wide' : 'is-rail'}`}
            aria-haspopup="dialog"
            aria-expanded={isOpen}
            aria-label="设置"
            onClick={openSettings}
            data-testid="guest-settings-trigger"
          >
            <span aria-hidden="true">⚙</span>
            {wide ? <span>设置</span> : null}
          </button>
          {updateAction}
        </div>
        {wide && updateStatus ? <p className="user-menu__status" role="status">{updateStatus}</p> : null}
        {updateError ? <p className="user-menu__error" role="alert">{updateError}</p> : null}
      </div>
    )
  }

  const label = displayName?.trim() || '小薇用户'

  return (
    <div className={`user-menu ${wide ? 'is-wide' : 'is-rail'}`} data-testid="user-menu">
      <div className="user-menu__row">
        <button
          type="button"
          className="user-menu__trigger"
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          onClick={() => { openSection('account') }}
          data-testid="user-menu-trigger"
        >
          <span className="user-menu__avatar" aria-hidden="true">{avatarChar(displayName, userId)}</span>
          {wide ? (
            <span className="user-menu__identity">
              <span className="user-menu__label" title={label}>{label}</span>
              <span className="user-menu__balance">{balance ? `${formatCnyFromMicros(balance.balanceMicros)} MiniMax 额度` : '额度加载中…'}</span>
            </span>
          ) : null}
        </button>
        {updateAction}
      </div>
      {wide && updateStatus ? <p className="user-menu__status" role="status">{updateStatus}</p> : null}
      {updateError ? <p className="user-menu__error" role="alert">{updateError}</p> : null}
    </div>
  )
}

/**
 * Register the desktop account launcher and Account settings section.
 * @param ctx - Desktop renderer client context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('settings.launcher', () => ctx.slots.register({ name: 'settings.launcher' }, UserMenu))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'account',
    order: 100,
    label: '账户',
  }, AccountSection))
}
