import { Context } from '@deepseek-ai/cordis'
import WebRuntime from '@deepseek-ai/dsh-web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as firecrawlPlugin from '../src/index.ts'
import {
  FirecrawlProvider,
  mapFirecrawlSearchResponse,
} from '../src/provider.ts'

const options = {
  apiKey: 'test-key',
  baseURL: 'https://api.firecrawl.test/v2',
  maxResponseBytes: 4096,
  maxSearchContentChars: 8,
  maxFetchBodyChars: 5,
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, ...init })
}

afterEach(() => vi.unstubAllGlobals())

describe('Firecrawl search mapping', () => {
  it('retains bounded Markdown and citeable public URLs', () => {
    expect(mapFirecrawlSearchResponse({
      success: true,
      data: { web: [
        { url: 'https://example.test/a', title: 'A', markdown: '123456' },
        { url: 'https://example.test/b', description: '7890' },
        { url: 'http://127.0.0.1/private', markdown: 'secret' },
      ] },
    }, 8)).toEqual({
      sources: [
        { url: 'https://example.test/a', title: 'A', snippet: '123456' },
        { url: 'https://example.test/b', snippet: '78' },
      ],
      truncated: false,
    })
  })

  it.each([null, {}, { success: false }, { success: true, data: {} }, {
    success: true,
    data: { web: [{ url: 1 }] },
  }, {
    success: true,
    data: { web: [{ url: 'https://example.test', markdown: 1 }] },
  }])('rejects invalid external JSON: %j', (value) => {
    expect(() => mapFirecrawlSearchResponse(value, 100))
      .toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })
})

describe('Firecrawl requests', () => {
  it('searches with extraction enabled, request bounds, and redirect blocking', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      success: true,
      data: { web: [{ url: 'https://example.test', markdown: 'weather' }] },
    }))
    vi.stubGlobal('fetch', fetchMock)
    await new FirecrawlProvider(options).search({ query: 'Shanghai weather', maxResults: 3 })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.firecrawl.test/v2/search')
    expect(init).toMatchObject({ method: 'POST', redirect: 'error' })
    expect(init.headers).toMatchObject({ authorization: 'Bearer test-key' })
    if (typeof init.body !== 'string') throw new TypeError('expected a JSON string request body')
    expect(JSON.parse(init.body) as unknown).toEqual({
      query: 'Shanghai weather',
      limit: 3,
      scrapeOptions: { formats: ['markdown'], onlyMainContent: true },
    })
  })

  it('scrapes public URLs to bounded text and preserves same-origin final URLs', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      success: true,
      data: {
        markdown: '123456789',
        metadata: { sourceURL: 'https://example.test/final', statusCode: 203 },
      },
    })))
    await expect(new FirecrawlProvider(options).fetch({ url: 'https://example.test/start' })).resolves.toEqual({
      url: 'https://example.test/final',
      statusCode: 203,
      body: { kind: 'text', content: '12345' },
      truncated: true,
    })
  })

  it('blocks private targets, cross-origin final URLs, and missing credentials', async () => {
    const provider = new FirecrawlProvider(options)
    await expect(provider.fetch({ url: 'http://127.0.0.1/admin' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_BLOCKED_URL' }))
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      success: true,
      data: { markdown: 'x', metadata: { sourceURL: 'https://other.test/' } },
    })))
    await expect(provider.fetch({ url: 'https://example.test/' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_REDIRECT_BLOCKED' }))
    const { apiKey: _apiKey, ...withoutApiKey } = options
    await expect(new FirecrawlProvider(withoutApiKey).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' }))
  })

  it('maps aborts, HTTP failures, malformed JSON, and oversized bodies', async () => {
    const controller = new AbortController()
    controller.abort('stop')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(new FirecrawlProvider(options).search({ query: 'q' }, controller.signal))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
    expect(fetchMock).not.toHaveBeenCalled()

    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 503 })))
    await expect(new FirecrawlProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json')))
    await expect(new FirecrawlProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { headers: { 'content-length': '5000' } })))
    await expect(new FirecrawlProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })
})

describe('Firecrawl availability', () => {
  it('allows hosted HTTPS and loopback HTTP endpoints only', () => {
    expect(new FirecrawlProvider(options).available()).toBe(true)
    expect(new FirecrawlProvider({ ...options, baseURL: 'http://localhost:3002/v2' }).available()).toBe(true)
    expect(new FirecrawlProvider({ ...options, baseURL: 'http://example.test/v2' }).available()).toBe(false)
    expect(new FirecrawlProvider({ ...options, baseURL: 'https://user@example.test/v2' }).available()).toBe(false)
    expect(new FirecrawlProvider({ ...options, baseURL: 'https://example.test/v2?q=1' }).available()).toBe(false)
    expect(new FirecrawlProvider({ ...options, maxResponseBytes: 1.5 }).available()).toBe(false)
  })
})

describe('Firecrawl plugin composition', () => {
  it('registers and disposes both provider roles through Cordis', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => (input instanceof Request ? input.url : input.toString()).endsWith('/search')
      ? jsonResponse({ success: true, data: { web: [] } })
      : jsonResponse({ success: true, data: { markdown: 'page' } })))
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: 'firecrawl', fetchProvider: 'firecrawl' })
    const fiber = await ctx.plugin(firecrawlPlugin, options)
    await expect(ctx.web.search({ query: 'q' })).resolves.toMatchObject({ sources: [] })
    await expect(ctx.web.fetch({ url: 'https://example.test/' })).resolves.toMatchObject({
      body: { kind: 'text', content: 'page' },
    })
    await fiber.dispose()
    await expect(ctx.web.search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CONFIGURED_MISSING' }))
  })
})
