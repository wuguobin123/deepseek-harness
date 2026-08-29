// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  authListener: undefined as ((state: unknown) => void) | undefined,
  disposeWorkbench: vi.fn(async () => undefined),
  bootRenderer: vi.fn(async (container: HTMLElement, _api: unknown, _baseUrl: string) => {
    const shell = document.createElement('div')
    shell.setAttribute('data-testid', 'workbench-root')
    container.appendChild(shell)
    return {
      ctx: {},
      dispose: async () => {
        shell.remove()
        await mocks.disposeWorkbench()
      },
    }
  }),
}))

vi.mock('../src/renderer/cordis-host', () => ({
  bootRenderer: async (container: HTMLElement, api: unknown, baseUrl: string) => {
    mocks.calls.push('boot-renderer')
    return mocks.bootRenderer(container, api, baseUrl)
  },
}))

vi.mock('../src/renderer/theme-persist', () => ({
  installPersistedTheme: vi.fn(),
}))

vi.mock('../src/renderer/dev-bridge', () => ({
  buildDevBridge: vi.fn(() => { throw new Error('packaged bridge expected') }),
}))

vi.mock('../src/renderer/features/auth/SignInCard', () => ({
  SignInCard: () => createElement('div', { className: 'signin-card', 'data-mode': 'signed-out' }, '登录'),
}))

describe('desktop Cordis renderer entry', () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    document.body.innerHTML = '<div id="root"></div>'
    mocks.calls.length = 0
    mocks.bootRenderer.mockClear()
    mocks.disposeWorkbench.mockClear()
    mocks.authListener = undefined
    Object.defineProperty(window, 'workbenchApi', {
      configurable: true,
      value: {
        async subscribeAuthState(listener: (state: unknown) => void) {
          mocks.calls.push('subscribe-auth')
          mocks.authListener = listener
          return () => undefined
        },
        async getAuthState() {
          mocks.calls.push('restore-auth')
          return { signedIn: false as const }
        },
        async getSession() {
          mocks.calls.push('read-session')
          return { baseUrl: 'http://127.0.0.1:18000' }
        },
      },
    })
  })

  it('mounts workspaces only while signed in and returns to the standalone login page on sign-out', async () => {
    await act(async () => { await import('../src/renderer/main.new') })

    expect(mocks.calls).toEqual([
      'subscribe-auth',
      'restore-auth',
    ])
    expect(mocks.bootRenderer).not.toHaveBeenCalled()
    expect(document.querySelector('[data-testid="signin-gate"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="workbench-root"]')).toBeNull()

    await act(async () => {
      mocks.authListener?.({
        signedIn: true,
        userId: 'user-1',
        displayName: '小名001',
        expiresAt: Date.now() + 60_000,
      })
    })
    await vi.waitFor(() => { expect(mocks.bootRenderer).toHaveBeenCalledOnce() })
    expect(mocks.calls.slice(-2)).toEqual(['read-session', 'boot-renderer'])
    expect(document.querySelector('[data-testid="signin-gate"]')).toBeNull()
    expect(document.querySelector('[data-testid="workbench-root"]')).not.toBeNull()

    await act(async () => { mocks.authListener?.({ signedIn: false }) })
    await vi.waitFor(() => {
      expect(mocks.disposeWorkbench).toHaveBeenCalledOnce()
      expect(document.querySelector('[data-testid="signin-gate"]')).not.toBeNull()
    })
    expect(document.querySelector('[data-testid="workbench-root"]')).toBeNull()
  })
})
