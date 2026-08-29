import { describe, expect, it } from 'vitest'
import { isAccountSearchMessage, parseAccountSearchMessage } from '@deepseek-ai/dsh-web-search-account-remote/ipc'

describe('account search IPC', () => {
  it('accepts only the minimal start request', () => {
    expect(parseAccountSearchMessage({
      type: 'xiaowei/web-search/start', requestId: 'r1', request: { query: 'x', maxResults: 3 },
    })).toEqual({ type: 'xiaowei/web-search/start', requestId: 'r1', request: { query: 'x', maxResults: 3 } })
  })

  it('rejects credential and identity fields', () => {
    expect(() => parseAccountSearchMessage({
      type: 'xiaowei/web-search/start', requestId: 'r1', request: { query: 'x', apiKey: 'secret' },
    })).toThrow('IPC field is not allowed')
  })

  it('rejects malformed results', () => {
    expect(() => parseAccountSearchMessage({ type: 'xiaowei/web-search/result', requestId: 'r1', result: null })).toThrow()
    expect(() => parseAccountSearchMessage({
      type: 'xiaowei/web-search/result', requestId: 'r1',
      result: { sources: [{ url: 'https://example.test', credential: 'secret' }], truncated: false },
    })).toThrow('IPC field is not allowed')
    expect(() => parseAccountSearchMessage({
      type: 'xiaowei/web-search/result', requestId: 'r1', result: { sources: [], truncated: 'no' },
    })).toThrow('IPC result truncated must be a boolean')
  })

  it('enforces the account RPC request limits', () => {
    expect(() => parseAccountSearchMessage({
      type: 'xiaowei/web-search/start', requestId: 'r1', request: { query: 'x'.repeat(4097) },
    })).toThrow('1 to 4096')
    expect(() => parseAccountSearchMessage({
      type: 'xiaowei/web-search/start', requestId: 'r1', request: { query: 'x', maxResults: 101 },
    })).toThrow('1 to 100')
  })

  it('distinguishes search IPC from inference and unrelated process messages', () => {
    expect(isAccountSearchMessage(JSON.stringify({ type: 'xiaowei/web-search/result' }))).toBe(true)
    expect(isAccountSearchMessage({ type: 'xiaowei/inference/chunk' })).toBe(false)
    expect(isAccountSearchMessage('{')).toBe(false)
  })
})
