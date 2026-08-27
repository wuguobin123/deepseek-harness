// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '../src/renderer/stores/auth'

const api = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  rotate: vi.fn(),
  walletGet: vi.fn(),
  modelKeysList: vi.fn(),
}))

vi.mock('../src/renderer/api', () => ({
  formatCnyFromMicros: () => '¥0.00',
  wallet: { get: api.walletGet },
  modelKeys: { list: api.modelKeysList },
  invites: { list: api.list, create: api.create, rotate: api.rotate },
}))

import { AccountSection } from '../src/renderer/features/account/AccountSection'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('desktop account invitations', () => {
  it('shows and copies active codes while offering explicit legacy regeneration', async () => {
    const activeCode = 'share-code-visible-1234'
    api.walletGet.mockResolvedValue({ userId: 'owner', balanceMicros: 0, updatedAt: Date.now() })
    api.modelKeysList.mockResolvedValue({ items: [] })
    api.list.mockResolvedValue({
      items: [
        {
          invitationId: 'active',
          code: activeCode,
          codeMask: '••••1234',
          createdAt: Date.now(),
          expiresAt: Date.now() + 60_000,
          consumedAt: null,
          redeemedBy: null,
        },
        {
          invitationId: 'legacy',
          code: null,
          codeMask: '••••5678',
          createdAt: Date.now(),
          expiresAt: Date.now() + 60_000,
          consumedAt: null,
          redeemedBy: null,
        },
        {
          invitationId: 'used',
          code: null,
          codeMask: '••••9999',
          createdAt: Date.now(),
          expiresAt: Date.now() + 60_000,
          consumedAt: Date.now(),
          redeemedBy: 'recipient',
        },
      ],
    })
    api.rotate.mockResolvedValue({
      invitationId: 'legacy',
      code: 'replacement-code-5678',
      codeMask: '••••5678',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      consumedAt: null,
      redeemedBy: null,
    })
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    useAuthStore.setState({
      initialized: true,
      state: { signedIn: true, userId: 'owner', displayName: '邀请人', expiresAt: Date.now() + 60_000 },
      error: null,
    })

    const container = document.createElement('div')
    const root = createRoot(container)
    await act(async () => {
      root.render(<AccountSection />)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.textContent).toContain(activeCode)
    expect(container.textContent).toContain('旧版分享码无法恢复，可重新生成')
    expect(container.textContent).toContain('••••9999')
    const copyButton = [...container.querySelectorAll('button')].find(button => button.textContent === '复制')
    expect(copyButton).toBeDefined()
    await act(async () => { copyButton!.click(); await Promise.resolve() })
    expect(writeText).toHaveBeenCalledWith(activeCode)

    const rotateButton = [...container.querySelectorAll('button')].find(button => button.textContent === '重新生成')
    expect(rotateButton).toBeDefined()
    await act(async () => {
      rotateButton!.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(window.confirm).toHaveBeenCalledWith('重新生成后，旧分享码会立即失效。确定继续吗？')
    expect(api.rotate).toHaveBeenCalledWith('legacy')
    expect(container.textContent).toContain('replacement-code-5678')

    await act(async () => { root.unmount() })
  })
})
