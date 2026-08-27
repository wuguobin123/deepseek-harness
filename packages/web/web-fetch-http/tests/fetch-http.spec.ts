import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { AddressInfo } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import WebRuntime from '@deepseek-ai/dsh-web'
import { HttpFetchProvider, LOCAL_FETCH_PROVIDER_ID } from '@deepseek-ai/dsh-web-fetch-http'
import type { HttpFetchDependencies, HttpFetchLimits } from '@deepseek-ai/dsh-web-fetch-http'
import * as fetchPlugin from '@deepseek-ai/dsh-web-fetch-http'
import { classifyContentType, decoderForCharset, isPublicAddress, isSameOrigin, parseCharset, validateFetchUrl } from '../src/policy.ts'
import { githubContentTarget, pinnedLookup } from '../src/provider.ts'

const limits: HttpFetchLimits = {
  maxUrlLength: 2048,
  maxResponseBytes: 5_000_000,
  maxBodyChars: 100_000,
  timeoutMs: 5_000,
  maxRedirects: 5,
  maxAttempts: 3,
  userAgent: 'test-agent/1.0',
}

type Handler = (req: IncomingMessage, res: ServerResponse) => void

let server: Server
let base: string
let handler: Handler

beforeEach(async () => {
  handler = (_req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('default') }
  server = createServer((req, res) => { handler(req, res) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  base = `http://127.0.0.1:${port}`
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await new Promise<void>(resolve => server.close(() => { resolve() }))
})

function provider(overrides: Partial<HttpFetchLimits> = {}): HttpFetchProvider {
  return new HttpFetchProvider({ ...limits, ...overrides }, {
    resolveAddresses: async () => [{ address: '93.184.216.34', family: 4 }],
    request: async (url, init) => await fetch(url, init),
  })
}

describe('public address policy', () => {
  it('blocks private, reserved, local, multicast, and mapped addresses', () => {
    for (const address of ['not-an-ip', '0.0.0.0', '10.0.0.1', '100.64.0.1', '127.0.0.1', '169.254.1.1', '192.0.2.1', '192.168.1.1', '224.0.0.1', '255.255.255.255', '::', '::1', 'fc00::1', 'fe80::1', 'ff02::1', '2001:db8::1', '::ffff:127.0.0.1']) {
      expect(isPublicAddress(address), address).toBe(false)
    }
    expect(isPublicAddress('8.8.8.8')).toBe(true)
    expect(isPublicAddress('2001:4860:4860::8888')).toBe(true)
    expect(isPublicAddress('::ffff:8.8.8.8')).toBe(true)
  })

  it('returns the pinned address for single and all-address Node lookups', async () => {
    const lookup = pinnedLookup([
      { address: '140.82.112.4', family: 4 },
      { address: '2606:50c0:8000::154', family: 6 },
    ])
    const single = await new Promise<{ address: string | import('node:dns').LookupAddress[]; family: number | undefined }>((resolve, reject) => {
      lookup('github.com', { all: false }, (error, address, family) => {
        if (error !== null) reject(error)
        else resolve({ address, family })
      })
    })
    const all = await new Promise<string | import('node:dns').LookupAddress[]>((resolve, reject) => {
      lookup('github.com', { all: true }, (error, address) => {
        if (error !== null) reject(error)
        else resolve(address)
      })
    })

    expect(single).toEqual({ address: '140.82.112.4', family: 4 })
    expect(all).toEqual([
      { address: '140.82.112.4', family: 4 },
      { address: '2606:50c0:8000::154', family: 6 },
    ])
  })

  it('rejects mixed public and private DNS answers before transport', async () => {
    const request = vi.fn<NonNullable<HttpFetchDependencies['request']>>()
    const guarded = new HttpFetchProvider(limits, {
      resolveAddresses: async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '10.0.0.8', family: 4 },
      ],
      request,
    })

    await expect(guarded.fetch({ url: 'https://github.com/deepseek-ai' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_BLOCKED_URL' }))
    expect(request).not.toHaveBeenCalled()
  })

  it('re-resolves a same-origin redirect and blocks a public-to-private change', async () => {
    const resolveAddresses = vi.fn()
      .mockResolvedValueOnce([{ address: '140.82.112.4', family: 4 }])
      .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }])
    const request = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: '/deepseek-ai/deepseek-harness' },
    }))
    const guarded = new HttpFetchProvider(limits, { resolveAddresses, request })

    await expect(guarded.fetch({ url: 'https://github.com/deepseek-ai' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_BLOCKED_URL' }))
    expect(resolveAddresses).toHaveBeenCalledTimes(2)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['GitHub raw text', 'https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/main/README.md', 'text/plain', '# DeepSeek Harness', 'text'],
  ] as const)('retrieves deterministic public %s content without credentials', async (_label, url, contentType, content, kind) => {
    const request = vi.fn(async (_url: URL, _init: RequestInit) => new Response(content, {
      status: 200,
      headers: { 'content-type': contentType },
    }))
    const guarded = new HttpFetchProvider(limits, {
      resolveAddresses: async () => [{ address: '140.82.112.4', family: 4 }],
      request,
    })

    await expect(guarded.fetch({ url })).resolves.toMatchObject({
      statusCode: 200,
      body: { kind, content },
    })
    expect(request).toHaveBeenCalledOnce()
    expect(request.mock.calls[0]?.[1].headers).not.toHaveProperty('authorization')
  })

  it('retrieves a repository README through the official GitHub API and preserves the source URL', async () => {
    const request = vi.fn(async (_url: URL, _init: RequestInit) => new Response('# DeepSeek Harness', {
      status: 200,
      headers: { 'content-type': 'application/vnd.github.raw+json; charset=utf-8' },
    }))
    const guarded = new HttpFetchProvider(limits, {
      resolveAddresses: async () => [{ address: '20.205.243.168', family: 4 }],
      request,
    })

    await expect(guarded.fetch({ url: 'https://github.com/deepseek-ai/deepseek-harness' })).resolves.toMatchObject({
      url: 'https://github.com/deepseek-ai/deepseek-harness',
      statusCode: 200,
      body: { kind: 'text', content: '# DeepSeek Harness' },
    })
    expect(request.mock.calls[0]?.[0].toString()).toBe('https://api.github.com/repos/deepseek-ai/deepseek-harness/readme')
    expect(request.mock.calls[0]?.[1].headers).toEqual(expect.objectContaining({
      accept: 'application/vnd.github.raw+json',
    }))
  })

  it('retrieves a GitHub blob through raw.githubusercontent.com and preserves the source URL', async () => {
    const request = vi.fn(async (_url: URL, _init: RequestInit) => new Response('# Configuration', {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    }))
    const guarded = new HttpFetchProvider(limits, {
      resolveAddresses: async () => [{ address: '185.199.110.133', family: 4 }],
      request,
    })
    const source = 'https://github.com/openai/codex/blob/main/docs/config.md'

    await expect(guarded.fetch({ url: source })).resolves.toMatchObject({
      url: source,
      body: { content: '# Configuration' },
    })
    expect(request.mock.calls[0]?.[0].toString()).toBe('https://api.github.com/repos/openai/codex/contents/docs/config.md?ref=main')
  })
})

describe('policy helpers', () => {
  it('validates scheme, credentials, and length', () => {
    expect(validateFetchUrl('https://example.com/x', 2048).hostname).toBe('example.com')
    expect(() => validateFetchUrl('ftp://example.com', 2048)).toThrow(expect.objectContaining({ code: 'WEB_INVALID_URL' }))
    expect(() => validateFetchUrl('not a url', 2048)).toThrow(expect.objectContaining({ code: 'WEB_INVALID_URL' }))
    expect(() => validateFetchUrl('https://user:pass@example.com', 2048)).toThrow(expect.objectContaining({ code: 'WEB_BLOCKED_URL' }))
    expect(() => validateFetchUrl(`https://example.com/${'a'.repeat(3000)}`, 2048)).toThrow(expect.objectContaining({ code: 'WEB_INVALID_URL' }))
  })

  it('classifies content types', () => {
    expect(classifyContentType('text/html; charset=utf-8')).toBe('html')
    expect(classifyContentType('application/xhtml+xml')).toBe('html')
    expect(classifyContentType('text/plain')).toBe('text')
    expect(classifyContentType('application/json')).toBe('text')
    expect(classifyContentType('image/png')).toBeUndefined()
    expect(classifyContentType(null)).toBeUndefined()
  })

  it('compares origins', () => {
    expect(isSameOrigin(new URL('https://a.com/x'), new URL('https://a.com/y'))).toBe(true)
    expect(isSameOrigin(new URL('https://a.com'), new URL('https://b.com'))).toBe(false)
    expect(isSameOrigin(new URL('http://a.com'), new URL('https://a.com'))).toBe(false)
  })

  it('maps only supported GitHub public-content URLs', () => {
    expect(githubContentTarget(new URL('https://www.github.com/openai/codex.git'))?.toString())
      .toBe('https://api.github.com/repos/openai/codex/readme')
    expect(githubContentTarget(new URL('https://github.com/openai/codex/raw/main/README.md'))?.toString())
      .toBe('https://api.github.com/repos/openai/codex/contents/README.md?ref=main')
    expect(githubContentTarget(new URL('https://raw.githubusercontent.com/openai/codex/main/README.md'))?.toString())
      .toBe('https://api.github.com/repos/openai/codex/contents/README.md?ref=main')
    expect(githubContentTarget(new URL('https://github.com/openai/codex/issues/1'))).toBeUndefined()
    expect(githubContentTarget(new URL('http://github.com/openai/codex'))).toBeUndefined()
    expect(githubContentTarget(new URL('https://example.com/openai/codex'))).toBeUndefined()
    expect(githubContentTarget(new URL('https://github.com/openai'))).toBeUndefined()
    expect(githubContentTarget(new URL('https://github.com/open%2Fai/codex'))).toBeUndefined()
    expect(githubContentTarget(new URL('https://github.com/openai/.git'))).toBeUndefined()
    expect(githubContentTarget(new URL('https://raw.githubusercontent.com/openai'))).toBeUndefined()
    expect(githubContentTarget(new URL('https://raw.githubusercontent.com/open%2Fai/codex/main/README.md'))).toBeUndefined()
  })

  it('parses the charset parameter', () => {
    expect(parseCharset('text/html; charset=UTF-8')).toBe('utf-8')
    expect(parseCharset('text/plain; charset="iso-8859-1"')).toBe('iso-8859-1')
    expect(parseCharset('text/plain')).toBeUndefined()
    expect(parseCharset(null)).toBeUndefined()
  })

  it('builds a decoder for a charset and defaults to UTF-8', () => {
    expect(decoderForCharset(undefined).encoding).toBe('utf-8')
    expect(decoderForCharset('iso-8859-1').encoding).toBe('windows-1252')
    expect(() => decoderForCharset('not-a-charset')).toThrow(expect.objectContaining({ code: 'WEB_UNSUPPORTED_CONTENT_TYPE' }))
  })
})

describe('HttpFetchProvider success', () => {
  it('retries a transport failure within the provider deadline', async () => {
    const request = vi.fn<NonNullable<HttpFetchDependencies['request']>>()
      .mockRejectedValueOnce(new Error('transient connect failure'))
      .mockResolvedValueOnce(new Response('recovered', { status: 200, headers: { 'content-type': 'text/plain' } }))
    const guarded = new HttpFetchProvider(limits, {
      resolveAddresses: async () => [{ address: '93.184.216.34', family: 4 }],
      request,
    })

    await expect(guarded.fetch({ url: 'https://example.com/' })).resolves.toMatchObject({
      body: { content: 'recovered' },
    })
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('fetches a text body', async () => {
    handler = (_req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('hello world') }
    const result = await provider().fetch({ url: base })
    expect(provider().available()).toBe(true)
    expect(result.statusCode).toBe(200)
    expect(result.body).toEqual({ kind: 'text', content: 'hello world' })
    expect(result.truncated).toBe(false)
  })

  it('fetches an html body and classifies it as html', async () => {
    handler = (_req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<h1>hi</h1>') }
    const result = await provider().fetch({ url: base })
    expect(result.body).toEqual({ kind: 'html', content: '<h1>hi</h1>' })
  })

  it('sends the configured user agent', async () => {
    let seen: string | undefined
    handler = (req, res) => { seen = req.headers['user-agent']; res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok') }
    await provider().fetch({ url: base })
    expect(seen).toBe('test-agent/1.0')
  })

  it('returns a non-2xx response as a result, not an error', async () => {
    handler = (_req, res) => { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('nope') }
    const result = await provider().fetch({ url: base })
    expect(result.statusCode).toBe(404)
    expect(result.body).toEqual({ kind: 'text', content: 'nope' })
  })
})

describe('HttpFetchProvider caps', () => {
  it('rejects an over-cap Content-Length with WEB_FETCH_TOO_LARGE', async () => {
    handler = (_req, res) => { res.writeHead(200, { 'content-type': 'text/plain', 'content-length': '999999' }); res.end('x'.repeat(999999)) }
    await expect(provider({ maxResponseBytes: 10 }).fetch({ url: base }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_FETCH_TOO_LARGE' }))
  })

  it('truncates a stream that grows past the byte cap', async () => {
    handler = (_req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('abcdefghij') }
    const result = await provider({ maxResponseBytes: 4 }).fetch({ url: base })
    expect(result.body.content).toBe('abcd')
    expect(result.truncated).toBe(true)
  })

  it('does not flag a body that exactly fills the byte cap as truncated', async () => {
    handler = (_req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('abcd') }
    const result = await provider({ maxResponseBytes: 4 }).fetch({ url: base })
    expect(result.body.content).toBe('abcd')
    expect(result.truncated).toBe(false)
  })

  it('truncates a decoded body past the character cap', async () => {
    handler = (_req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('abcdefghij') }
    const result = await provider({ maxBodyChars: 3 }).fetch({ url: base })
    expect(result.body.content).toBe('abc')
    expect(result.truncated).toBe(true)
  })

  it('rejects an unsupported content type', async () => {
    handler = (_req, res) => { res.writeHead(200, { 'content-type': 'image/png' }); res.end('binary') }
    await expect(provider().fetch({ url: base }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_UNSUPPORTED_CONTENT_TYPE' }))
  })

  it('rejects a response with no content type at all', async () => {
    handler = (_req, res) => { res.writeHead(200); res.end('no type') }
    await expect(provider().fetch({ url: base }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_UNSUPPORTED_CONTENT_TYPE' }))
  })

  it('accepts a declared content-length within the cap', async () => {
    handler = (_req, res) => { const body = 'sized'; res.writeHead(200, { 'content-type': 'text/plain', 'content-length': String(body.length) }); res.end(body) }
    const result = await provider().fetch({ url: base })
    expect(result.body.content).toBe('sized')
  })

  it('decodes a non-UTF-8 declared charset', async () => {
    // 0xE9 is "é" in ISO-8859-1; decoded as UTF-8 it would be a replacement char.
    handler = (_req, res) => { res.writeHead(200, { 'content-type': 'text/plain; charset=iso-8859-1' }); res.end(Buffer.from([0x63, 0x61, 0x66, 0xE9])) }
    const result = await provider().fetch({ url: base })
    expect(result.body.content).toBe('café')
  })

  it('rejects an unsupported declared charset', async () => {
    handler = (_req, res) => { res.writeHead(200, { 'content-type': 'text/plain; charset=not-a-charset' }); res.end('x') }
    await expect(provider().fetch({ url: base }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_UNSUPPORTED_CONTENT_TYPE' }))
  })
})

describe('HttpFetchProvider redirects', () => {
  it('follows a same-origin redirect and reports the final URL', async () => {
    handler = (req, res) => {
      if (req.url === '/start') { res.writeHead(302, { location: '/end' }); res.end() }
      else { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('arrived') }
    }
    const result = await provider().fetch({ url: `${base}/start` })
    expect(result.body.content).toBe('arrived')
    expect(result.url).toBe(`${base}/end`)
  })

  it('blocks a cross-origin redirect with WEB_REDIRECT_BLOCKED', async () => {
    handler = (_req, res) => { res.writeHead(302, { location: 'https://example.com/' }); res.end() }
    await expect(provider().fetch({ url: base }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_REDIRECT_BLOCKED' }))
  })

  it('re-validates a redirect target, rejecting same-origin credentials in the Location', async () => {
    const { port } = server.address() as AddressInfo
    handler = (_req, res) => { res.writeHead(302, { location: `http://user:pass@127.0.0.1:${port}/` }); res.end() }
    await expect(provider().fetch({ url: base }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_BLOCKED_URL' }))
  })

  it('rejects exceeding the redirect hop cap', async () => {
    handler = (req, res) => {
      const n = Number(new URL(req.url ?? '/', base).searchParams.get('n') ?? '0')
      res.writeHead(302, { location: `/?n=${n + 1}` })
      res.end()
    }
    await expect(provider({ maxRedirects: 2 }).fetch({ url: `${base}/?n=0` }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_REDIRECT_BLOCKED' }))
  })

  it('follows exactly maxRedirects hops: a chain landing on the Nth redirect succeeds', async () => {
    // maxRedirects: 2 → /?n=0 → /?n=1 → /?n=2(200). Exactly 2 redirects + 1
    // final = 3 requests; the cap is inclusive of the landing request.
    let requests = 0
    handler = (req, res) => {
      requests++
      const n = Number(new URL(req.url ?? '/', base).searchParams.get('n') ?? '0')
      if (n >= 2) { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('landed') }
      else { res.writeHead(302, { location: `/?n=${n + 1}` }); res.end() }
    }
    const result = await provider({ maxRedirects: 2 }).fetch({ url: `${base}/?n=0` })
    expect(result.body.content).toBe('landed')
    expect(requests).toBe(3)
  })

  it('makes exactly maxRedirects+1 requests before blocking an over-long chain', async () => {
    // maxRedirects: 2 on an infinite chain: requests at n=0,1,2 (the 3rd is the
    // over-limit redirect, refused before its Location is followed) = 3 total.
    let requests = 0
    handler = (req, res) => {
      requests++
      const n = Number(new URL(req.url ?? '/', base).searchParams.get('n') ?? '0')
      res.writeHead(302, { location: `/?n=${n + 1}` })
      res.end()
    }
    await expect(provider({ maxRedirects: 2 }).fetch({ url: `${base}/?n=0` }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_REDIRECT_BLOCKED', message: 'exceeded the maximum of 2 redirects' }))
    expect(requests).toBe(3)
  })

  it('reports an over-limit redirect as "exceeded", not cross-origin, even when the over-limit hop points cross-origin', async () => {
    // The redirect budget is checked BEFORE the over-limit hop's target is
    // origin-validated, so the diagnosis is "exceeded", not "cross-origin".
    handler = (req, res) => {
      const n = Number(new URL(req.url ?? '/', base).searchParams.get('n') ?? '0')
      const location = n === 0 ? '/?n=1' : 'https://example.com/'
      res.writeHead(302, { location })
      res.end()
    }
    await expect(provider({ maxRedirects: 1 }).fetch({ url: `${base}/?n=0` }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_REDIRECT_BLOCKED', message: 'exceeded the maximum of 1 redirects' }))
  })

  it('maxRedirects: 0 follows no redirect but still fetches a direct 200', async () => {
    handler = (req, res) => {
      if (req.url === '/r') { res.writeHead(302, { location: '/done' }); res.end() }
      else { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('direct') }
    }
    await expect(provider({ maxRedirects: 0 }).fetch({ url: `${base}/r` }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_REDIRECT_BLOCKED' }))
    const direct = await provider({ maxRedirects: 0 }).fetch({ url: `${base}/done` })
    expect(direct.body.content).toBe('direct')
  })

  it('treats a redirect without a Location header as a provider error', async () => {
    handler = (_req, res) => { res.writeHead(302); res.end() }
    await expect(provider().fetch({ url: base }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('follows a relative same-origin redirect', async () => {
    handler = (req, res) => {
      if (req.url === '/a') { res.writeHead(301, { location: 'b' }); res.end() }
      else { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('landed') }
    }
    const result = await provider().fetch({ url: `${base}/a` })
    expect(result.body.content).toBe('landed')
  })
})

describe('HttpFetchProvider invalid URLs and abort', () => {
  it('rejects a non-http scheme before any network access', async () => {
    await expect(provider().fetch({ url: 'ftp://example.com' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_INVALID_URL' }))
  })

  it('rejects credentials in the URL', async () => {
    await expect(provider().fetch({ url: 'http://user:pass@127.0.0.1/' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_BLOCKED_URL' }))
  })

  it('blocks private IPv4 and IPv6 literals before DNS or network access', async () => {
    await expect(new HttpFetchProvider(limits).fetch({ url: 'http://127.0.0.1/' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_BLOCKED_URL' }))
    await expect(new HttpFetchProvider(limits).fetch({ url: 'http://[::1]/' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_BLOCKED_URL' }))
  })

  it('maps a DNS resolution failure to WEB_PROVIDER_ERROR', async () => {
    const guarded = new HttpFetchProvider(limits, {
      resolveAddresses: async () => { throw new Error('resolver unavailable') },
    })
    await expect(guarded.fetch({ url: 'https://github.com/' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('closes the pinned dispatcher after a request-phase failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('connection failed') }))
    await expect(new HttpFetchProvider(limits).fetch({ url: 'https://8.8.8.8/' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('maps an AbortError from transport even before the signal observes cancellation', async () => {
    const guarded = new HttpFetchProvider(limits, {
      resolveAddresses: async () => [{ address: '140.82.112.4', family: 4 }],
      request: async () => { throw new DOMException('aborted', 'AbortError') },
    })
    await expect(guarded.fetch({ url: 'https://github.com/' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('honors a pre-aborted signal', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(provider().fetch({ url: base }, controller.signal))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('aborts an in-flight fetch via the signal', async () => {
    handler = (_req, _res) => { /* never responds */ }
    const controller = new AbortController()
    const promise = provider().fetch({ url: base }, controller.signal)
    controller.abort()
    await expect(promise).rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('times out a slow response with WEB_FETCH_TIMEOUT', async () => {
    handler = (_req, _res) => { /* never responds */ }
    await expect(provider({ timeoutMs: 50 }).fetch({ url: base }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_FETCH_TIMEOUT' }))
  })

  it('classifies a timeout DURING the body read as WEB_FETCH_TIMEOUT, not WEB_ABORTED', async () => {
    // Promise body that resolves headers (so fetch() returns) but a content-length
    // that outlasts the bytes sent, so readCapped()'s reader awaits more and the
    // timeout fires mid-read — the reader then surfaces a generic AbortError that
    // must still be recovered as the timeout reason via signal.reason.
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain', 'content-length': '100' })
      res.write('partial')
      // never send the remaining bytes nor end the response
    }
    await expect(provider({ timeoutMs: 80 }).fetch({ url: base }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_FETCH_TIMEOUT' }))
  })

  it('maps a connection failure to WEB_PROVIDER_ERROR', async () => {
    // Port 1 on loopback is not listening: a real connection failure (not abort).
    await expect(provider().fetch({ url: 'http://127.0.0.1:1/' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

})

describe('HttpFetchProvider body cancellation on error paths', () => {
  /** A fake Response whose body.cancel is observable. */
  type FakeInit = { status: number; headers: Record<string, string>; location?: string }
  function fakeResponse(init: FakeInit): { response: Response; cancelled: () => boolean } {
    let cancelled = false
    const headers = new Headers(init.headers)
    if (init.location !== undefined) headers.set('location', init.location)
    const response = {
      status: init.status,
      headers,
      body: { cancel: () => { cancelled = true; return Promise.resolve() } },
    } as unknown as Response
    return { response, cancelled: () => cancelled }
  }

  it('cancels the body when a cross-origin redirect is blocked', async () => {
    const { response, cancelled } = fakeResponse({ status: 302, headers: {}, location: 'https://elsewhere.test/' })
    vi.stubGlobal('fetch', vi.fn(async () => response))
    await expect(provider().fetch({ url: 'http://127.0.0.1:9/' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_REDIRECT_BLOCKED' }))
    expect(cancelled()).toBe(true)
  })

  it('cancels the body when an unsupported charset is rejected', async () => {
    const { response, cancelled } = fakeResponse({ status: 200, headers: { 'content-type': 'text/plain; charset=not-a-charset' } })
    vi.stubGlobal('fetch', vi.fn(async () => response))
    await expect(provider().fetch({ url: 'http://127.0.0.1:9/' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_UNSUPPORTED_CONTENT_TYPE' }))
    expect(cancelled()).toBe(true)
  })

  it('cancels the body when a redirect has no Location header', async () => {
    const { response, cancelled } = fakeResponse({ status: 302, headers: {} })
    vi.stubGlobal('fetch', vi.fn(async () => response))
    await expect(provider().fetch({ url: 'http://127.0.0.1:9/' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
    expect(cancelled()).toBe(true)
  })

  it('cancels the body when a redirect Location cannot be parsed', async () => {
    const { response, cancelled } = fakeResponse({ status: 302, headers: {}, location: 'http://[' })
    vi.stubGlobal('fetch', vi.fn(async () => response))
    await expect(provider().fetch({ url: 'http://127.0.0.1:9/' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
    expect(cancelled()).toBe(true)
  })
})

describe('web-fetch-http plugin registration', () => {
  it('registers the provider into ctx.web (HMR-safe)', async () => {
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { fetchProvider: LOCAL_FETCH_PROVIDER_ID })
    const fiber = await ctx.plugin(fetchPlugin, {})
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } })))
    await expect(ctx.web.fetch({ url: 'https://example.com/' }))
      .resolves.toMatchObject({ statusCode: 200 })
    await fiber.dispose()
    await expect(ctx.web.fetch({ url: 'https://example.com/' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CONFIGURED_MISSING' }))
  })

  it('has no default export (namespace plugin export shape)', () => {
    expect('default' in fetchPlugin).toBe(false)
  })

  it('rejects a non-positive resource limit at construction', async () => {
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { fetchProvider: LOCAL_FETCH_PROVIDER_ID })
    await expect(ctx.plugin(fetchPlugin, { maxResponseBytes: -1 }))
      .rejects.toThrow(/maxResponseBytes must be a positive finite number/)
  })

  it('rejects a zero timeout at construction', async () => {
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { fetchProvider: LOCAL_FETCH_PROVIDER_ID })
    await expect(ctx.plugin(fetchPlugin, { timeoutMs: 0 }))
      .rejects.toThrow(/timeoutMs must be a positive finite number/)
  })

  it('rejects a timeout beyond Node timer range at construction', async () => {
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { fetchProvider: LOCAL_FETCH_PROVIDER_ID })
    await expect(ctx.plugin(fetchPlugin, { timeoutMs: 2_147_483_648 }))
      .rejects.toThrow(/timeoutMs must be no greater than 2147483647/)
  })

  it('rejects a fractional redirect cap at construction', async () => {
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { fetchProvider: LOCAL_FETCH_PROVIDER_ID })
    await expect(ctx.plugin(fetchPlugin, { maxRedirects: 1.5 }))
      .rejects.toThrow(/maxRedirects must be a non-negative integer/)
  })

  it('rejects a negative redirect cap at construction', async () => {
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { fetchProvider: LOCAL_FETCH_PROVIDER_ID })
    await expect(ctx.plugin(fetchPlugin, { maxRedirects: -1 }))
      .rejects.toThrow(/maxRedirects must be a non-negative integer/)
  })

  it('rejects a non-positive transport attempt cap at construction', async () => {
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { fetchProvider: LOCAL_FETCH_PROVIDER_ID })
    await expect(ctx.plugin(fetchPlugin, { maxAttempts: 0 }))
      .rejects.toThrow(/maxAttempts must be a positive integer/)
  })

  it('accepts maxRedirects: 0 (follow no redirects) as valid config', async () => {
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { fetchProvider: LOCAL_FETCH_PROVIDER_ID })
    const fiber = await ctx.plugin(fetchPlugin, { maxRedirects: 0 })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } })))
    await expect(ctx.web.fetch({ url: 'https://example.com/' }))
      .resolves.toMatchObject({ statusCode: 200 })
    await fiber.dispose()
  })
})
