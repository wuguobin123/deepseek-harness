import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import WebRuntime from '@deepseek-ai/dsh-web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as searxngPlugin from '../src/index.ts'
import * as searxngInvariant from '../src/invariant.ts'
import { SearxngSearchProvider, mapSearxngResponse } from '../src/provider.ts'

const options = { baseURL: 'http://localhost:8080', maxResponseBytes: 1024 }

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, ...init })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SearXNG response mapping', () => {
  it('maps complete results, omits empty fields, duplicate URLs, and non-http URLs', () => {
    expect(mapSearxngResponse({
      results: [
        { url: 'https://example.test/a', title: 'A', content: 'snippet', publishedDate: '2026-01-01' },
        { url: 'https://example.test/a', title: 'duplicate' },
        { url: 'http://example.test/b', title: '', content: '', publishedDate: '' },
        { url: 'javascript:alert(1)', title: 'bad' },
      ],
    })).toEqual({
      sources: [
        { url: 'https://example.test/a', title: 'A', snippet: 'snippet', publishedAt: '2026-01-01' },
        { url: 'http://example.test/b' },
      ],
      truncated: false,
    })
  })

  it.each([
    null,
    {},
    { results: {} },
    { results: [null] },
    { results: [{}] },
    { results: [{ url: 'https://example.test', title: 1 }] },
    { results: [{ url: 'https://example.test', content: 1 }] },
    { results: [{ url: 'https://example.test', publishedDate: 1 }] },
  ])('rejects invalid external JSON: %j', (value) => {
    expect(() => mapSearxngResponse(value)).toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('accepts null optional fields as omitted external values', () => {
    expect(mapSearxngResponse({
      results: [{ url: 'https://example.test', title: null, content: null, publishedDate: null }],
    })).toEqual({ sources: [{ url: 'https://example.test' }], truncated: false })
  })
})

describe('SearXNG provider availability', () => {
  it('allows HTTPS and loopback HTTP only', () => {
    expect(new SearxngSearchProvider(options).available()).toBe(true)
    expect(new SearxngSearchProvider({ ...options, baseURL: 'https://search.example.test/base/' }).available()).toBe(true)
    expect(new SearxngSearchProvider({ ...options, baseURL: 'http://127.0.0.1:8080' }).available()).toBe(true)
    expect(new SearxngSearchProvider({ ...options, baseURL: 'http://[::1]:8080' }).available()).toBe(true)
    expect(new SearxngSearchProvider({ ...options, baseURL: 'not a URL' }).available()).toBe(false)
    expect(new SearxngSearchProvider({ ...options, baseURL: 'ftp://example.test' }).available()).toBe(false)
    expect(new SearxngSearchProvider({ ...options, baseURL: 'http://example.test' }).available()).toBe(false)
    expect(new SearxngSearchProvider({ ...options, baseURL: 'https://user@example.test' }).available()).toBe(false)
    expect(new SearxngSearchProvider({ ...options, baseURL: 'https://example.test?q=1' }).available()).toBe(false)
    expect(new SearxngSearchProvider({ ...options, baseURL: 'https://example.test/#part' }).available()).toBe(false)
  })

  it('requires a positive whole-number response cap', () => {
    expect(new SearxngSearchProvider({ ...options, maxResponseBytes: 0 }).available()).toBe(false)
    expect(new SearxngSearchProvider({ ...options, maxResponseBytes: 1.5 }).available()).toBe(false)
  })
})

describe('SearXNG provider requests', () => {
  it('posts form data, normalized path, headers, and the optional abort signal', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ results: [{ url: 'https://example.test' }] }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    await new SearxngSearchProvider({ ...options, baseURL: 'http://localhost:8080/' })
      .search({ query: 'hello world' }, controller.signal)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://localhost:8080/search')
    expect(init).toMatchObject({ method: 'POST', redirect: 'error', signal: controller.signal })
    expect(init.headers).toMatchObject({
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': 'deepseek-harness/0.0.1',
    })
    expect(init.body).toBe('q=hello+world&format=json')
  })

  it('omits the signal field when the caller supplies none', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ results: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await new SearxngSearchProvider(options).search({ query: 'q' })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init).not.toHaveProperty('signal')
  })
})

describe('SearXNG provider errors', () => {
  it('rejects a request whose signal is already aborted without calling fetch', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    controller.abort('stop')
    await expect(new SearxngSearchProvider(options).search({ query: 'q' }, controller.signal))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('maps network and fetch abort failures', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('connection refused'))))
    await expect(new SearxngSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new DOMException('aborted', 'AbortError'))))
    await expect(new SearxngSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('maps an HTTP error after reading its bounded response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unavailable', { status: 503 })))
    await expect(new SearxngSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'SearXNG API error (HTTP 503)' }))
  })

  it('rejects declared and streamed oversized responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('small', { headers: { 'content-length': '2048' } })))
    await expect(new SearxngSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x'.repeat(2048), { status: 200 })))
    await expect(new SearxngSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('rejects malformed JSON and structurally invalid JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json')))
    await expect(new SearxngSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ results: {} })))
    await expect(new SearxngSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('reports cancellation that wins while a body finishes reading', async () => {
    const controller = new AbortController()
    const response = {
      body: null,
      headers: new Headers(),
      ok: true,
      status: 200,
      arrayBuffer: () => {
        controller.abort('stop')
        return Promise.resolve(new TextEncoder().encode('not json').buffer)
      },
    } as unknown as Response
    vi.stubGlobal('fetch', vi.fn(async () => response))
    await expect(new SearxngSearchProvider(options).search({ query: 'q' }, controller.signal))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('maps stream read failures and aborts during body reads', async () => {
    const failed = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new TypeError('stream failed'))
      },
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(failed)))
    await expect(new SearxngSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))

    const controller = new AbortController()
    const abortedBody = new ReadableStream<Uint8Array>({
      pull(stream) {
        stream.enqueue(new TextEncoder().encode('{"results":[]}'))
        controller.abort('stop')
        stream.close()
      },
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(abortedBody)))
    await expect(new SearxngSearchProvider(options).search({ query: 'q' }, controller.signal))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('supports a bodyless response implementation and enforces its cap', async () => {
    const bodyless = (body: string): Response => ({
      body: null,
      headers: new Headers(),
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.resolve(new TextEncoder().encode(body).buffer),
    }) as unknown as Response
    vi.stubGlobal('fetch', vi.fn(async () => bodyless('{"results":[]}')))
    await expect(new SearxngSearchProvider(options).search({ query: 'q' }))
      .resolves.toMatchObject({ sources: [] })
    vi.stubGlobal('fetch', vi.fn(async () => bodyless('x'.repeat(2048))))
    await expect(new SearxngSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })
})

describe('SearXNG plugin composition', () => {
  it('registers and disposes the provider through Cordis', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ results: [] })))
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: searxngPlugin.SEARXNG_PROVIDER_ID })
    const fiber = await ctx.plugin(searxngPlugin, options)
    await expect(ctx.web.search({ query: 'q' })).resolves.toMatchObject({ sources: [] })
    await fiber.dispose()
    await expect(ctx.web.search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CONFIGURED_MISSING' }))
  })

  it('uses environment and constant defaults when config omits values', async () => {
    const previous = process.env.SEARXNG_BASE_URL
    process.env.SEARXNG_BASE_URL = 'http://127.0.0.1:9080'
    try {
      const fetchMock = vi.fn(async (_input: string | URL | Request) => jsonResponse({ results: [] }))
      vi.stubGlobal('fetch', fetchMock)
      const ctx = new Context()
      await ctx.plugin(WebRuntime, { searchProvider: searxngPlugin.SEARXNG_PROVIDER_ID })
      await ctx.plugin(searxngPlugin, {})
      await ctx.web.search({ query: 'q' })
      expect(fetchMock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:9080/search')
    } finally {
      if (previous === undefined) delete process.env.SEARXNG_BASE_URL
      else process.env.SEARXNG_BASE_URL = previous
    }

    const previousAfterRestore = process.env.SEARXNG_BASE_URL
    delete process.env.SEARXNG_BASE_URL
    try {
      const fetchMock = vi.fn(async (_input: string | URL | Request) => jsonResponse({ results: [] }))
      vi.stubGlobal('fetch', fetchMock)
      const ctx = new Context()
      await ctx.plugin(WebRuntime, { searchProvider: searxngPlugin.SEARXNG_PROVIDER_ID })
      await ctx.plugin(searxngPlugin, {})
      await ctx.web.search({ query: 'q' })
      expect(fetchMock.mock.calls[0]?.[0]).toBe('http://localhost:8080/search')
    } finally {
      if (previousAfterRestore !== undefined) process.env.SEARXNG_BASE_URL = previousAfterRestore
    }
  })

  it('has no default export and loads its invariant companion', async () => {
    expect('default' in searxngPlugin).toBe(false)
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(searxngInvariant).await()).resolves.toBeDefined()
  })
})
