/**
 * SignInCard — xiaowei account entry point.
 *
 * Five operating modes:
 *   1. Initializing: shows a placeholder while the cold-start probe loads.
 *   2. Signed in: transition placeholder while the workbench remounts.
 *   3. Sign in: email + password form posting to `account.signin`.
 *   4. Sign up: email + password + displayName + 6-digit verification code,
 *      posting to `account.signup`. A "Send code" button mints a code via
 *      `account.emailCode` and starts a cooldown countdown so the user
 *      cannot spam the request endpoint.
 *
 * Dev-mode hook: when the backend's email-verification seam is using the
 * in-process `LoggingEmailSender` (no SMTP configured), the response from
 * `account.emailCode` carries the raw code in `devCode`. The card paints a
 * clearly labeled banner with copy / auto-fill actions so the user can
 * finish sign-up without an SMTP relay. When real SMTP is wired up the
 * field is absent and no banner is shown.
 *
 * The card subscribes to the auth store on mount; broadcast events from the
 * main process keep the store coherent across windows.
 * Non-compact account gates also show the Xiaowei product mark and title above
 * the form heading; compact settings embeds retain the form-only layout.
 */
import { useEffect, useState } from 'react'
import { useAuthStore } from '../../stores/auth'
import xiaoweiLogo from '../brand/xiaowei-logo.png'

export interface SignInCardProps {
  /** Optional className for layout integration. */
  className?: string
  /** Compact mode hides the duplicate account heading — used by Settings. */
  compact?: boolean
  /** Keep the signed-out form reachable while the background auth probe runs. */
  eagerSignedOut?: boolean
}

type FormMode = 'signin' | 'signup'

function SignInBrand(): React.JSX.Element {
  return (
    <div className="signin-card__brand" data-testid="signin-brand">
      <img
        className="signin-card__brand-logo"
        src={xiaoweiLogo}
        alt=""
        aria-hidden="true"
        width={64}
        height={64}
      />
      <h1 className="signin-card__brand-title">小薇助手</h1>
    </div>
  )
}

export function SignInCard(props: SignInCardProps): React.JSX.Element {
  const { className, compact = false, eagerSignedOut = false } = props
  const initialized = useAuthStore(s => s.initialized)
  const state = useAuthStore(s => s.state)
  const error = useAuthStore(s => s.error)
  const refresh = useAuthStore(s => s.refresh)
  const signIn = useAuthStore(s => s.signIn)
  const signUp = useAuthStore(s => s.signUp)
  const [mode, setMode] = useState<FormMode>('signin')

  useEffect(() => {
    if (!initialized) void refresh()
  }, [initialized, refresh])

  if (!initialized && !eagerSignedOut) {
    return (
      <div className={className ?? 'signin-card'} data-mode="loading">
        <SignInBrand />
        {!compact ? <h2 className="signin-card__title">账户</h2> : null}
        <p className="signin-card__hint">加载中…</p>
      </div>
    )
  }

  if (state.signedIn) {
    return (
      <div className={className ?? 'signin-card'} data-mode="signed-in">
        <p className="signin-card__hint">正在进入工作台…</p>
      </div>
    )
  }

  return (
    <AuthForm
      mode={mode}
      onSwitchMode={setMode}
      error={error}
      onSignIn={signIn}
      onSignUp={signUp}
      compact={compact}
      className={className}
    />
  )
}

interface AuthFormProps {
  mode: FormMode
  onSwitchMode: (mode: FormMode) => void
  error: string | null
  onSignIn: (input: { email: string; password: string }) => Promise<{ ok: boolean; error?: string }>
  onSignUp: (input: {
    email: string
    password: string
    displayName?: string
    verificationCode?: string
    invitationCode: string
  }) => Promise<{ ok: boolean; error?: string }>
  compact: boolean
  className?: string
}

function AuthForm(props: AuthFormProps): React.JSX.Element {
  const { mode, onSwitchMode, error, onSignIn, onSignUp, compact, className } = props
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
  const [invitationCode, setInvitationCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [codeRequestBusy, setCodeRequestBusy] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  const isSignup = mode === 'signup'

  const requestEmailCode = useAuthStore(s => s.requestEmailCode)
  const codeCooldown = useAuthStore(s => s.codeCooldown)
  const codeError = useAuthStore(s => s.codeError)
  const tickCodeCooldown = useAuthStore(s => s.tickCodeCooldown)
  // Dev-mode verification code — populated by the store only when the
  // backend's email-verification seam is using the in-process logging
  // transport (no SMTP configured). SMTP-backed deploys leave it null and
  // the banner below is not rendered.
  const devCode = useAuthStore(s => s.devCode)

  // Decrement the cooldown once per second when active.
  useEffect(() => {
    if (codeCooldown <= 0) return
    const id = setInterval(tickCodeCooldown, 1000)
    return () => { clearInterval(id) }
  }, [codeCooldown, tickCodeCooldown])

  // Reset transient form state when switching modes so old data does not
  // bleed across the tab boundary (verification code is signup-only).
  useEffect(() => {
    setLocalError(null)
    setVerificationCode('')
  }, [mode])

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    setBusy(true)
    setLocalError(null)
    const trimmedEmail = email.trim()
    if (isSignup && invitationCode.trim().length === 0) {
      setBusy(false)
      setLocalError('请输入分享码')
      return
    }
    if (isSignup && verificationCode.length !== 6) {
      setBusy(false)
      setLocalError('请先输入 6 位验证码')
      return
    }
    try {
      const result = isSignup
        ? await onSignUp({
          email: trimmedEmail,
          password,
          ...(displayName.trim().length > 0 ? { displayName: displayName.trim() } : {}),
          verificationCode,
          invitationCode: invitationCode.trim(),
        })
        : await onSignIn({ email: trimmedEmail, password })
      if (!result.ok) {
        setLocalError(result.error ?? (isSignup ? '注册失败' : '登录失败'))
      }
    } catch (submitError) {
      setLocalError((submitError as Error).message || (isSignup ? '注册失败' : '登录失败'))
    } finally {
      setBusy(false)
    }
  }

  async function onSendCode(): Promise<void> {
    setLocalError(null)
    const trimmedEmail = email.trim()
    if (trimmedEmail.length < 3 || !trimmedEmail.includes('@')) {
      setLocalError('请先填写有效的邮箱')
      return
    }
    if (invitationCode.trim().length === 0) {
      setLocalError('请先输入分享码')
      return
    }
    setCodeRequestBusy(true)
    try {
      await requestEmailCode({ email: trimmedEmail, invitationCode: invitationCode.trim() })
    } catch (requestError) {
      setLocalError((requestError as Error).message || '验证码发送失败')
    } finally {
      setCodeRequestBusy(false)
    }
  }

  function applyDevCode(): void {
    if (devCode === null) return
    setVerificationCode(devCode)
  }

  async function copyDevCode(): Promise<void> {
    if (devCode === null) return
    try {
      // `navigator.clipboard` is available in the Electron renderer process
      // without an explicit permission grant — the renderer origin is the
      // local file:// scheme and the BrowserWindow has clipboard access by
      // default. If this throws (very old Electron / sandbox), fall back to
      // selecting the code text so the user can copy it manually.
      await navigator.clipboard.writeText(devCode)
    } catch {
      /* swallow — fallback handled by user-select on the value element */
    }
  }

  return (
    <form
      className={className ?? 'signin-card'}
      data-mode={isSignup ? 'signup' : 'signed-out'}
      onSubmit={(event) => { void submit(event) }}
    >
      <SignInBrand />
      {!compact ? <h2 className="signin-card__title">账户</h2> : null}
      <div className="signin-card__tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={!isSignup}
          className={`signin-card__tab ${!isSignup ? 'is-active' : ''}`}
          onClick={() =>{  onSwitchMode('signin') }}
        >
          登录
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={isSignup}
          className={`signin-card__tab ${isSignup ? 'is-active' : ''}`}
          onClick={() =>{  onSwitchMode('signup') }}
        >
          注册
        </button>
      </div>
      <p className="signin-card__hint">
        {isSignup ? '使用分享码创建小薇账户，注册即获赠 20 元额度。' : '登录小薇账户。'}
      </p>
      <label className="signin-card__field">
        <span>邮箱</span>
        <input
          type="email"
          name="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) =>{  setEmail(event.target.value) }}
        />
      </label>
      <label className="signin-card__field">
        <span>密码</span>
        <input
          type="password"
          name="password"
          autoComplete={isSignup ? 'new-password' : 'current-password'}
          required
          minLength={isSignup ? 8 : 1}
          value={password}
          onChange={(event) =>{  setPassword(event.target.value) }}
        />
      </label>
      {isSignup ? (
        <>
          <label className="signin-card__field">
            <span>分享码</span>
            <input type="text" name="invitationCode" required value={invitationCode} onChange={(event) => { setInvitationCode(event.target.value) }} />
          </label>
          <label className="signin-card__field">
            <span>显示名（可选）</span>
            <input
              type="text"
              name="displayName"
              autoComplete="nickname"
              value={displayName}
              onChange={(event) =>{  setDisplayName(event.target.value) }}
            />
          </label>
          {devCode !== null ? (
            <div
              className="signin-card__dev-code"
              role="status"
              aria-live="polite"
              data-testid="signin-dev-code"
            >
              <div className="signin-card__dev-code-head">开发模式 — 邮件通道未配置</div>
              <div className="signin-card__dev-code-body">
                <span
                  className="signin-card__dev-code-value"
                  aria-label="开发模式验证码"
                  title="点击可全选；可一键填入下方输入框或复制"
                >
                  {devCode}
                </span>
                <div className="signin-card__dev-code-actions">
                  <button
                    type="button"
                    onClick={applyDevCode}
                    disabled={verificationCode === devCode}
                    data-testid="signin-dev-code-apply"
                  >
                    {verificationCode === devCode ? '已填入' : '一键填入'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { void copyDevCode() }}
                    data-testid="signin-dev-code-copy"
                  >
                    复制
                  </button>
                </div>
              </div>
              <p className="signin-card__dev-code-hint">
                本机后端未配置 SMTP，验证码无法送达邮箱。如需走真实邮箱，请设置
                <code>XIAOWEI_SMTP_HOST</code> 等环境变量后重启后端；当前
                可直接使用上方的 6 位数字完成注册。
              </p>
            </div>
          ) : null}
          <div className="signin-card__field signin-card__field--row">
            <label className="signin-card__field signin-card__field--code">
              <span>邮箱验证码</span>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                autoComplete="one-time-code"
                name="verificationCode"
                placeholder="6 位数字"
                required
                value={verificationCode}
                onChange={(event) =>{  setVerificationCode(event.target.value.replace(/[^0-9]/g, '').slice(0, 6)) }}
              />
            </label>
            <button
              type="button"
              className="signin-card__send-code"
              disabled={codeCooldown > 0 || busy || codeRequestBusy}
              onClick={() => { void onSendCode() }}
            >
              {codeRequestBusy ? '发送中…' : codeCooldown > 0 ? `${codeCooldown}s 后可重发` : '发送验证码'}
            </button>
          </div>
        </>
      ) : null}
      {localError !== null || error !== null || codeError !== null ? (
        <p className="signin-card__error" role="alert">
          {localError ?? codeError ?? error}
        </p>
      ) : null}
      <button type="submit" className="signin-card__submit" disabled={busy}>
        {busy
          ? isSignup ? '注册中…' : '登录中…'
          : isSignup ? '注册' : '登录'}
      </button>
    </form>
  )
}
