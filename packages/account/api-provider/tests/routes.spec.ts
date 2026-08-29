import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { ACCOUNT_RPC_METHODS, assertRoutePartition, createAccountApiProvider } from '../src/index.ts'

describe('account RPC route ownership', () => {
  it('keeps account routes disjoint from core and covers the complete registry', () => {
    const core = ['workspace.list', 'workspace.create', 'fs.read']
    expect(() => { assertRoutePartition(core, [...core, ...ACCOUNT_RPC_METHODS]) }).not.toThrow()
  })

  it('rejects overlap and uncovered methods', () => {
    expect(() => { assertRoutePartition(['account.signin'], ACCOUNT_RPC_METHODS) }).toThrow(/overlaps/)
    expect(() => { assertRoutePartition([], ACCOUNT_RPC_METHODS.slice(0, -1)) }).toThrow(/absent/)
  })

  it('forwards account-owned search through ctx.web with the request signal', async () => {
    const ctx = new Context()
    const search = vi.fn(async () => ({ sources: [{ url: 'https://example.test' }], truncated: false }))
    ctx.provide('web', { search } as never)
    const signal = new AbortController().signal
    const result = await createAccountApiProvider(ctx).dispatch({
      rpcId: 'search-1', payload: { query: 'example', maxResults: 2 },
      principal: { kind: 'account', userId: 'user-1' }, signal,
    }, 'account.web.search')
    expect(result).toEqual({
      rpcId: 'search-1', result: { ok: true, value: {
        sources: [{ url: 'https://example.test' }], truncated: false,
      } },
    })
    expect(search).toHaveBeenCalledWith({ query: 'example', maxResults: 2 }, signal)
  })
})
