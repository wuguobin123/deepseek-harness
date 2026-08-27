// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EnvironmentSettingsRow } from '../src/renderer/environment-settings'

let host: HTMLDivElement
let root: Root
const getSession = vi.fn()
const updateSession = vi.fn()

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  getSession.mockResolvedValue({
    baseUrl: 'https://cloud.example.test',
    lastLocation: 'local',
    version: '3',
  })
  updateSession.mockResolvedValue({ ok: true, value: { baseUrl: 'https://cloud.example.test' } })
  Object.assign(window, {
    workbenchApi: { getSession, updateSession },
  })
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  vi.clearAllMocks()
})

describe('desktop last Workspace location row', () => {
  it('updates the preference without changing global Host availability', async () => {
    await act(async () => {
      root.render(<EnvironmentSettingsRow />)
      await Promise.resolve()
    })

    const select = host.querySelector<HTMLSelectElement>('select[aria-label="默认工作区位置"]')!
    expect(select.value).toBe('local')
    expect(select.disabled).toBe(false)

    await act(async () => {
      select.value = 'cloud'
      select.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
    })

    expect(updateSession).toHaveBeenCalledWith({
      baseUrl: 'https://cloud.example.test',
      lastLocation: 'cloud',
    })
    expect(select.value).toBe('cloud')
  })
})
