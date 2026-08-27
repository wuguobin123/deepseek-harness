// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  bootRenderer: vi.fn(async (..._args: unknown[]) => ({ ctx: {}, dispose: async () => undefined })),
}))

vi.mock('../src/renderer/cordis-host', () => ({
  bootRenderer: async (...args: unknown[]) => {
    mocks.calls.push('boot-renderer')
    return mocks.bootRenderer(...args)
  },
}))

vi.mock('../src/renderer/theme-persist', () => ({
  installPersistedTheme: vi.fn(),
}))

vi.mock('../src/renderer/dev-bridge', () => ({
  buildDevBridge: vi.fn(() => { throw new Error('packaged bridge expected') }),
}))

describe('desktop Cordis renderer entry', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>'
    mocks.calls.length = 0
    mocks.bootRenderer.mockClear()
    Object.defineProperty(window, 'workbenchApi', {
      configurable: true,
      value: {
        async subscribeAuthState() {
          mocks.calls.push('subscribe-auth')
          return () => undefined
        },
        async getAuthState() {
          mocks.calls.push('restore-auth')
          return {
            signedIn: true as const,
            userId: 'user-1',
            displayName: '小名001',
            expiresAt: Date.now() + 60_000,
          }
        },
        async getSession() {
          mocks.calls.push('read-session')
          return { baseUrl: 'http://127.0.0.1:18000' }
        },
      },
    })
  })

  it('restores the durable account before mounting sidebar chrome', async () => {
    await import('../src/renderer/main.new')

    expect(mocks.calls).toEqual([
      'subscribe-auth',
      'restore-auth',
      'read-session',
      'boot-renderer',
    ])
    expect(mocks.bootRenderer).toHaveBeenCalledOnce()
  })
})
