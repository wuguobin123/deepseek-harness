// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  walletGet: vi.fn(),
  getUpdate: vi.fn(),
  checkUpdate: vi.fn(),
  openDownload: vi.fn(),
  subscribeUpdate: vi.fn(),
}))

vi.mock('../src/renderer/api', () => ({
  wallet: { get: mocks.walletGet },
  modelKeys: { list: vi.fn(async () => ({ items: [] })) },
  formatCnyFromMicros: (micros: number) => `¥${(micros / 1_000_000).toFixed(2)}`,
  update: {
    getState: mocks.getUpdate,
    check: mocks.checkUpdate,
    openDownload: mocks.openDownload,
    subscribe: mocks.subscribeUpdate,
  },
}))

import { UserMenu } from '../src/renderer/features/auth/UserMenu'
import { useAuthStore } from '../src/renderer/stores/auth'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  mocks.walletGet.mockResolvedValue({ userId: 'user-1', balanceMicros: 20_000_000, updatedAt: 1 })
  mocks.getUpdate.mockResolvedValue({ status: 'available', currentVersion: '0.3.1', latestVersion: '0.4.0', downloadUrl: 'https://example/app.dmg' })
  mocks.checkUpdate.mockResolvedValue({ status: 'up-to-date', currentVersion: '0.3.1' })
  mocks.openDownload.mockResolvedValue({ ok: true })
  mocks.subscribeUpdate.mockImplementation(async () => () => undefined)
  useAuthStore.setState({
    initialized: true,
    state: { signedIn: true, userId: 'user-1', displayName: '小名001', expiresAt: Date.now() + 60_000 },
  })
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  vi.clearAllMocks()
})

describe('desktop sidebar account chrome', () => {
  it('keeps Settings and client update reachable while local mode is signed out', async () => {
    useAuthStore.setState({ initialized: true, state: { signedIn: false } })
    const openSettings = vi.fn()
    await act(async () => {
      root.render(<UserMenu wide isOpen={false} openSettings={openSettings} openSection={vi.fn()} />)
      await Promise.resolve()
    })

    const trigger = host.querySelector<HTMLButtonElement>('[data-testid="guest-settings-trigger"]')!
    const update = host.querySelector<HTMLButtonElement>('[data-testid="user-menu-update"]')!
    expect(trigger.textContent).toContain('设置')
    expect(update.getAttribute('aria-label')).toBe('客户端有新版本 0.4.0')
    await act(async () => { trigger.click() })
    expect(openSettings).toHaveBeenCalledOnce()

    await act(async () => { update.click(); await Promise.resolve() })
    expect(mocks.openDownload).toHaveBeenCalledOnce()
    expect(host.textContent).toContain('更新安装程序已启动')
  })

  it('opens Account from the user body and keeps the right-side update action independent', async () => {
    const openSection = vi.fn()
    await act(async () => {
      root.render(<UserMenu wide isOpen={false} openSettings={vi.fn()} openSection={openSection} />)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(host.textContent).toContain('小名001')
    expect(host.textContent).toContain('¥20.00 MiniMax 额度')
    const row = host.querySelector('.user-menu__row')!
    const trigger = host.querySelector<HTMLButtonElement>('[data-testid="user-menu-trigger"]')!
    const update = host.querySelector<HTMLButtonElement>('[data-testid="user-menu-update"]')!
    expect(row.lastElementChild).toBe(update)
    expect(update.getAttribute('aria-label')).toBe('客户端有新版本 0.4.0')

    await act(async () => { trigger.click() })
    expect(openSection).toHaveBeenCalledWith('account')

    openSection.mockClear()
    await act(async () => { update.click(); await Promise.resolve() })
    expect(mocks.openDownload).toHaveBeenCalledOnce()
    expect(openSection).not.toHaveBeenCalled()
    expect(host.textContent).toContain('更新安装程序已启动')
  })

  it('reports the result of a manual up-to-date check', async () => {
    mocks.getUpdate.mockResolvedValue({ status: 'up-to-date', currentVersion: '0.3.4' })
    mocks.checkUpdate.mockResolvedValue({ status: 'up-to-date', currentVersion: '0.3.4' })
    await act(async () => {
      root.render(<UserMenu wide isOpen={false} openSettings={vi.fn()} openSection={vi.fn()} />)
      await Promise.resolve()
      await Promise.resolve()
    })

    const update = host.querySelector<HTMLButtonElement>('[data-testid="user-menu-update"]')!
    await act(async () => { update.click(); await Promise.resolve() })
    expect(mocks.checkUpdate).toHaveBeenCalledOnce()
    expect(host.textContent).toContain('已是最新版本 0.3.4')
  })

  it('renders separate account and update hit areas in the collapsed rail', async () => {
    await act(async () => {
      root.render(<UserMenu wide={false} isOpen={false} openSettings={vi.fn()} openSection={vi.fn()} />)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(host.querySelector('.user-menu.is-rail')).not.toBeNull()
    expect(host.querySelectorAll('button')).toHaveLength(2)
    expect(host.textContent).not.toContain('¥20.00 MiniMax 额度')
  })
})
