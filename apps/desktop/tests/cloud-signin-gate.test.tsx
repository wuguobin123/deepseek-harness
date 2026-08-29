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

describe('cloud sign-in gate', () => {
  it('does not offer a signed-out shortcut to local workspaces', async () => {
    await act(async () => { root.render(<CloudSignInGate />) })

    expect(host.querySelector('[data-testid="sign-in-card"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="return-local"]')).toBeNull()
  })
})
