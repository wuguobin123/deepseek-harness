import { describe, expect, it } from 'vitest'
import { resolveDirectoryFlowSurface } from '../src/renderer/directory-flow'

describe('resolveDirectoryFlowSurface', () => {
  it('resolves native for loopback baseUrls', () => {
    expect(resolveDirectoryFlowSurface('http://127.0.0.1:18000')).toBe('native')
    expect(resolveDirectoryFlowSurface('http://127.0.0.2:18000')).toBe('native')
    expect(resolveDirectoryFlowSurface('http://localhost:3000')).toBe('native')
    expect(resolveDirectoryFlowSurface('http://[::1]:8080')).toBe('native')
  })

  it('resolves local-copy import for remote baseUrls', () => {
    expect(resolveDirectoryFlowSurface('http://119.45.252.25:18080')).toBe('import')
    expect(resolveDirectoryFlowSurface('https://xiaowei.119.45.252.25.nip.io')).toBe('import')
    expect(resolveDirectoryFlowSurface('http://192.168.1.10:18000')).toBe('import')
  })

  it('fails to import for unparseable or empty baseUrls', () => {
    expect(resolveDirectoryFlowSurface('')).toBe('import')
    expect(resolveDirectoryFlowSurface('not a url')).toBe('import')
  })
})
