import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import BusinessConnectorRegistry from '@deepseek-ai/dsh-business-connector'
import type { BusinessOperation } from '@deepseek-ai/dsh-business-skill'
import { apply, HttpConnector } from '../src/index.ts'

const operation: BusinessOperation = {
  id: 'registered-accounts', method: 'GET', path: '/metrics/accounts', input: { type: 'object' },
  output: { type: 'object' }, permission: 'metrics.accounts.read',
  connection: 'https://business.example/api/', risk: 'R1',
}

describe('HTTPS business connector', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('injects trusted identity and never reads identity from model input', async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => (
      new Response(JSON.stringify({ count: 7 }), { status: 200 })
    ))
    vi.stubGlobal('fetch', fetch)
    const connector = new HttpConnector('https://business.example/api/', {
      timeoutMs: 1_000, maxResponseBytes: 1_024, credentialRefs: ['BUSINESS_TOKEN'],
    })
    await expect(connector.execute({
      operation,
      input: { query: 'today' },
      principal: { userId: 'platform-user' },
      credential: 'service-secret',
    })).resolves.toEqual({ count: 7 })
    const [, init] = fetch.mock.calls[0] ?? []
    expect(init?.headers).toMatchObject({
      authorization: 'Bearer service-secret',
      'x-xiaowei-user-id': 'platform-user',
      'x-xiaowei-required-permission': 'metrics.accounts.read',
    })
  })

  it('rejects a path that escapes the approved base', async () => {
    const connector = new HttpConnector('https://business.example/api/', {
      timeoutMs: 1_000, maxResponseBytes: 1_024, credentialRefs: [],
    })
    await expect(connector.execute({
      operation: { ...operation, path: '/../admin' }, input: {}, principal: { userId: 'platform-user' },
    })).rejects.toThrow(/escapes approved base/)
  })

  it('accepts only the default HTTPS port on an allowlisted host', async () => {
    const ctx = new Context()
    await ctx.plugin(BusinessConnectorRegistry)
    apply(ctx, {
      hosts: ['business.example'], credentialRefs: [], timeoutMs: 1_000, maxResponseBytes: 1_024,
    })
    expect(ctx.businessConnectors.get('https://business.example/api/')).toBeDefined()
    expect(ctx.businessConnectors.get('https://business.example:8443/api/')).toBeUndefined()
  })

  it('retries transient responses and forwards trace without tenant by default', async () => {
    let attempts = 0
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      attempts += 1
      return attempts === 1
        ? new Response('busy', { status: 503 })
        : new Response(JSON.stringify({ count: 2 }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetch)
    const connector = new HttpConnector('https://business.example/api/', {
      timeoutMs: 1_000, maxResponseBytes: 1_024, credentialRefs: [], retries: 1,
    })
    await expect(connector.execute({ operation, input: {}, principal: { userId: 'u' }, traceId: 'trace-1' })).resolves.toEqual({ count: 2 })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({ 'x-xiaowei-trace-id': 'trace-1' })
    expect(fetch.mock.calls[0]?.[1]?.headers).not.toHaveProperty('x-xiaowei-tenant-id')
  })

  it('does not retry authentication failures', async () => {
    const fetch = vi.fn(async () => new Response('no', { status: 401 }))
    vi.stubGlobal('fetch', fetch)
    const connector = new HttpConnector('https://business.example/api/', {
      timeoutMs: 1_000, maxResponseBytes: 1_024, credentialRefs: [], retries: 3,
    })
    await expect(connector.execute({ operation, input: {}, principal: { userId: 'u' } })).rejects.toThrow('HTTP 401')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('forwards a tenant only when trusted context supplies one', async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => (
      new Response(JSON.stringify({ count: 1 }), { status: 200 })
    ))
    vi.stubGlobal('fetch', fetch)
    const connector = new HttpConnector('https://business.example/api/', {
      timeoutMs: 1_000, maxResponseBytes: 1_024, credentialRefs: [],
    })
    await connector.execute({ operation, input: {}, principal: { userId: 'u', tenantId: 'trusted-tenant' } })
    expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({ 'x-xiaowei-tenant-id': 'trusted-tenant' })
  })

  it('does not retry invalid JSON or an oversized successful response', async () => {
    const invalid = vi.fn(async () => new Response('not-json', { status: 200 }))
    vi.stubGlobal('fetch', invalid)
    const connector = new HttpConnector('https://business.example/api/', {
      timeoutMs: 1_000, maxResponseBytes: 4, credentialRefs: [], retries: 3,
    })
    await expect(connector.execute({ operation, input: {}, principal: { userId: 'u' } }))
      .rejects.toThrow('exceeds byte limit')
    expect(invalid).toHaveBeenCalledTimes(1)

    const malformed = vi.fn(async () => new Response('{', { status: 200 }))
    vi.stubGlobal('fetch', malformed)
    const roomy = new HttpConnector('https://business.example/api/', {
      timeoutMs: 1_000, maxResponseBytes: 1_024, credentialRefs: [], retries: 3,
    })
    await expect(roomy.execute({ operation, input: {}, principal: { userId: 'u' } }))
      .rejects.toThrow('response is not JSON')
    expect(malformed).toHaveBeenCalledTimes(1)
  })
})
