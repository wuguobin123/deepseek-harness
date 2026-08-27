// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/renderer/features/auth/SignInCard', () => ({
  SignInCard: () => <div data-testid="sign-in-card">登录</div>,
}))

import { CloudSignInGate } from '../src/renderer/features/auth/CloudSignInGate'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
})

describe('cloud sign-in environment recovery', () => {
  it('switches a signed-out user back to local with the persisted base URL', async () => {
    const updateSession = vi.fn(async () => ({ ok: true as const, value: { baseUrl: 'https://cloud.example.test' } }))
    const api = {
      getSession: vi.fn(async () => ({ baseUrl: 'https://cloud.example.test', environment: 'cloud' as const, lastLocation: 'cloud' as const, version: '3' as const })),
      updateSession,
    }
    await act(async () => { root.render(<CloudSignInGate api={api} />) })

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="return-local"]')!.click()
      await Promise.resolve()
    })

    expect(updateSession).toHaveBeenCalledWith({
      baseUrl: 'https://cloud.example.test',
      lastLocation: 'local',
    })
  })
})
