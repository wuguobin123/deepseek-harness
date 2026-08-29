// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SignInCard } from '../src/renderer/features/auth/SignInCard'
import { AccountSection } from '../src/renderer/features/account/AccountSection'
import { useAuthStore } from '../src/renderer/stores/auth'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('desktop account entry', () => {
  it('renders the Xiaowei logo and title above the account form', () => {
    useAuthStore.setState({
      initialized: true,
      state: { signedIn: false },
      error: null,
      codeCooldown: 0,
      codeError: null,
      devCode: null,
    })

    const markup = renderToStaticMarkup(<SignInCard />)
    const brandOffset = markup.indexOf('data-testid="signin-brand"')
    const accountOffset = markup.indexOf('>账户</h2>')

    expect(brandOffset).toBeGreaterThanOrEqual(0)
    expect(markup).toContain('class="signin-card__brand-logo"')
    expect(markup).toContain('width="64"')
    expect(markup).toContain('小薇助手')
    expect(accountOffset).toBeGreaterThan(brandOffset)
  })

  it('requires a share code on the registration form', async () => {
    useAuthStore.setState({
      initialized: true,
      state: { signedIn: false },
      error: null,
      codeCooldown: 0,
      codeError: null,
      devCode: null,
    })
    const container = document.createElement('div')
    const root = createRoot(container)
    await act(async () => { root.render(<SignInCard />) })
    const registrationTab = [...container.querySelectorAll('button')]
      .find(button => button.textContent === '注册')
    expect(registrationTab).toBeDefined()
    await act(async () => { registrationTab!.click() })
    const invitation = container.querySelector<HTMLInputElement>('input[name="invitationCode"]')
    expect(invitation?.required).toBe(true)
    expect(container.textContent).toContain('分享码')
    await act(async () => { root.unmount() })
  })

  it('does not embed a local-workspace bypass after sign-out', () => {
    useAuthStore.setState({
      initialized: true,
      state: { signedIn: false },
      error: null,
      codeCooldown: 0,
      codeError: null,
      devCode: null,
    })

    const markup = renderToStaticMarkup(<AccountSection />)
    expect(markup).toContain('正在返回登录页面')
    expect(markup).not.toContain('本机工作区不需登录')
    expect(markup).not.toContain('data-testid="signin-brand"')
  })

  it('shows three invitation slots in the signed-in account section', async () => {
    useAuthStore.setState({
      initialized: true,
      state: {
        signedIn: true,
        userId: 'user-invitation-owner',
        displayName: '邀请人',
        expiresAt: Date.now() + 60_000,
      },
      error: null,
    })

    const container = document.createElement('div')
    const root = createRoot(container)
    await act(async () => { root.render(<AccountSection />) })
    expect(container.textContent).toContain('我的分享码')
    expect(container.textContent).toContain('已创建 0 / 3')
    expect(container.textContent).toContain('创建分享码')
    await act(async () => { root.unmount() })
  })
})
