/**
 * Auth store (renderer-side).
 *
 * Mirrors the main-process `CredentialStore.authState()` projection and
 * subscribes to IPC fan-out so every window sees sign-in / sign-out within
 * one tick. The store is the source of truth for `useAuthState()` /
 * `<SignInCard />`; the main process owns the durable token.
 */
import { create } from 'zustand'
import type { AuthState } from '../../shared/contracts'
import * as api from '../api'

const EMPTY_AUTH: AuthState = { signedIn: false }

function localizedAuthError(error: { code: string; message: string }, fallback: string): string {
  switch (error.code) {
    case 'unauthenticated': return '邮箱或密码错误'
    case 'email-taken': return '该邮箱已注册'
    case 'invitation-invalid': return '分享码无效、已过期或已被使用'
    case 'user-limit': return '当前内测名额已满（100 人）'
    case 'email-code-resend-cooldown': return '请稍后再发送验证码'
    case 'email-code-rate-limit': return '验证码发送次数过多，请稍后再试'
    case 'email-code-wrong': return '邮箱验证码错误'
    case 'email-code-expired': return '邮箱验证码已过期，请重新获取'
    case 'email-code-locked': return '验证码错误次数过多，请稍后重试'
    case 'verification-code-required': return '请先获取邮箱验证码'
    default: return error.message || fallback
  }
}

interface AuthStoreState {
  initialized: boolean
  state: AuthState
  /** Last sign-in error message (cleared on retry). */
  error: string | null
  /** Seconds remaining on the email-verification-code cooldown. 0 = idle. */
  codeCooldown: number
  /** Last `requestEmailCode` error message (cleared on success). */
  codeError: string | null
  /**
   * The most recent dev-mode verification code returned by the backend,
   * if any. Populated only when the backend's email-verification seam is
   * using the in-process logging transport (i.e. SMTP is not configured).
   * The SignInCard paints it in a clearly labeled banner so the user can
   * complete sign-up without an SMTP relay.
   */
  devCode: string | null
  refresh: () => Promise<void>
  signIn: (input: { email: string; password: string }) => Promise<{ ok: boolean; error?: string }>
  signUp: (input: {
    email: string
    password: string
    displayName?: string
    verificationCode?: string
    invitationCode: string
  }) => Promise<{ ok: boolean; error?: string }>
  signOut: () => Promise<{ ok: boolean; error?: string }>
  requestEmailCode: (input: { email: string; invitationCode: string }) => Promise<{ ok: boolean; error?: string; devCode?: string }>
  /** Decrement the cooldown timer by one second. Bound to a setInterval. */
  tickCodeCooldown: () => void
}

export const useAuthStore = create<AuthStoreState>((set, get) => ({
  initialized: false,
  state: EMPTY_AUTH,
  error: null,
  codeCooldown: 0,
  codeError: null,
  devCode: null,
  async refresh() {
    try {
      const state = await api.auth.getState()
      set({ initialized: true, state, error: null })
    } catch (err) {
      set({ initialized: true, state: EMPTY_AUTH, error: (err as Error).message })
    }
  },
  async signIn(input: { email: string; password: string }) {
    const result = await api.auth.signIn(input)
    if (!result.ok) {
      const message = 'error' in result ? localizedAuthError(result.error, '登录失败') : '登录失败'
      set({ error: message })
      return { ok: false, error: message }
    }
    set({ state: result.value, error: null })
    return { ok: true }
  },
  async signUp(input: { email: string; password: string; displayName?: string; verificationCode?: string; invitationCode: string }) {
    const result = await api.auth.signUp(input)
    if (!result.ok) {
      const message = 'error' in result ? localizedAuthError(result.error, '注册失败') : '注册失败'
      set({ error: message })
      return { ok: false, error: message }
    }
    set({ state: result.value, error: null, codeCooldown: 0, codeError: null, devCode: null })
    return { ok: true }
  },
  async signOut() {
    const result = await api.auth.signOut()
    set({ state: result.value, error: null })
    return { ok: true }
  },
  async requestEmailCode(input: { email: string; invitationCode: string }) {
    if (get().codeCooldown > 0) {
      return { ok: false, error: '请等待冷却结束再发送验证码' }
    }
    const result = await api.auth.requestEmailCode(input)
    if (!result.ok) {
      const message = 'error' in result ? localizedAuthError(result.error, '验证码发送失败') : '验证码发送失败'
      set({ codeError: message, devCode: null })
      return { ok: false, error: message }
    }
    set({
      codeCooldown: result.value.retryAfterSeconds,
      codeError: null,
      // Only surface dev mode when the backend explicitly returned a code.
      // Empty / omitted `devCode` means real SMTP is in play — clear any
      // stale value so the banner disappears once SMTP is configured.
      devCode: result.value.devCode ?? null,
    })
    return { ok: true, ...(result.value.devCode !== undefined ? { devCode: result.value.devCode } : {}) }
  },
  tickCodeCooldown() {
    const current = get().codeCooldown
    if (current <= 0) return
    set({ codeCooldown: current - 1 })
  },
}))

/**
 * Wire the store to the main-process IPC broadcast. Call once at boot; the
 * returned function unsubscribes. Each fan-out event is parsed and merged in
 * — invalid payloads are silently dropped (the main process owns the schema).
 */
export async function bindAuthStore(): Promise<() => void> {
  const unsubscribe = await api.auth.subscribe((state) => {
    useAuthStore.setState({ initialized: true, state, error: null })
  })
  return unsubscribe
}
