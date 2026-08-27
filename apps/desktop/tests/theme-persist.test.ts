import { afterEach, describe, expect, it, vi } from 'vitest'
import { installPersistedTheme } from '../src/renderer/theme-persist'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('desktop theme pre-paint', () => {
  it('applies light mode without consulting a legacy persisted preference', () => {
    const removed: string[] = []
    const documentElement = {
      style: { colorScheme: '' },
      removeAttribute: (name: string) => { removed.push(`html:${name}`) },
    }
    const body = { removeAttribute: (name: string) => { removed.push(`body:${name}`) } }
    const getItem = vi.fn(() => 'dark')
    vi.stubGlobal('document', { documentElement, body })
    vi.stubGlobal('localStorage', { getItem })
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })))

    expect(installPersistedTheme()).toBe('light')
    expect(removed).toEqual([
      'html:data-ds-dark-theme',
      'body:data-ds-dark-theme',
    ])
    expect(documentElement.style.colorScheme).toBe('light')
    expect(getItem).not.toHaveBeenCalled()
  })

  it('returns the light product mode outside a document environment', () => {
    vi.stubGlobal('document', undefined)
    expect(installPersistedTheme()).toBe('light')
  })
})
