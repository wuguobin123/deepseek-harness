/**
 * Tests for `apps/desktop/src/main/api-client.ts`.
 *
 * Focused on the `setToken` round-trip: every outbound `call` carries the
 * bearer header when a token is set, omits it after `setToken(null)`, and
 * the same applies to `respond`. The fetch implementation is a stub recording
 * every call so we can assert headers without standing up an HTTP server.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiClient, ApiClientError } from '../src/main/api-client'

interface CapturedCall {
  url: string
  init: RequestInit
  body: unknown
}

let calls: CapturedCall[] = []
let nextStatus = 200
let nextBody: unknown = { type: 'server-response', rpcId: '', result: { ok: true, value: {} } }

beforeEach(() => {
  calls = []
  nextStatus = 200
  nextBody = { type: 'server-response', rpcId: '', result: { ok: true, value: {} } }
})

afterEach(() => {
  vi.restoreAllMocks()
})

function buildFetch(): typeof fetch {
  return async (input: Request | string | URL, init?: RequestInit): Promise<Response> => {
    const requestInit: RequestInit = init ?? (typeof input === 'object' && input !== null && !(input instanceof Request) ? (input as RequestInit) : {})
    let url: string
    if (typeof input === 'string') {
      url = input
    } else if (input instanceof URL) {
      url = input.toString()
    } else {
      url = input.url
    }
    const text = typeof requestInit.body === 'string' ? requestInit.body : ''
    let parsed: unknown = null
    if (text) parsed = JSON.parse(text)
    calls.push({ url, init: requestInit, body: parsed })
    // Echo the request rpcId back so the api-client's correlation check passes.
    const envelope = parsed as { rpcId?: string } | null
    const rpcId = envelope?.rpcId ?? ''
    const body = typeof nextBody === 'object' && nextBody !== null
      ? { ...(nextBody as Record<string, unknown>), rpcId }
      : nextBody
    return new Response(JSON.stringify(body), { status: nextStatus, headers: { 'content-type': 'application/json' } })
  }
}

function findBearerHeader(call: CapturedCall): string | undefined {
  const headers = (call.init.headers ?? {}) as Record<string, string>
  if (!('authorization' in headers)) return undefined
  return headers.authorization
}

describe('ApiClient setToken', () => {
  it('omits the Authorization header before setToken is called', async () => {
    const client = new ApiClient({ baseUrl: 'http://localhost:18000', fetchImpl: buildFetch() })
    nextBody = {
      type: 'server-response',
      rpcId: 'r1',
      result: { ok: true, value: { ok: true } },
    }
    await client.call('host.describe', {})
    expect(calls).toHaveLength(1)
    expect(findBearerHeader(calls[0])).toBeUndefined()
  })

  it('attaches Authorization: Bearer <token> after setToken', async () => {
    const client = new ApiClient({ baseUrl: 'http://localhost:18000', fetchImpl: buildFetch() })
    client.setToken('tkn-1')
    nextBody = {
      type: 'server-response',
      rpcId: 'r2',
      result: { ok: true, value: { ok: true } },
    }
    await client.call('host.describe', {})
    expect(findBearerHeader(calls[0])).toBe('Bearer tkn-1')
  })

  it('drops the header after setToken(null)', async () => {
    const client = new ApiClient({ baseUrl: 'http://localhost:18000', fetchImpl: buildFetch() })
    client.setToken('tkn-1')
    client.setToken(null)
    nextBody = {
      type: 'server-response',
      rpcId: 'r3',
      result: { ok: true, value: { ok: true } },
    }
    await client.call('host.describe', {})
    expect(findBearerHeader(calls[0])).toBeUndefined()
  })

  it('surfaces RPC errors with the wire code on the ApiClientError', async () => {
    const client = new ApiClient({ baseUrl: 'http://localhost:18000', fetchImpl: buildFetch() })
    nextStatus = 200
    nextBody = {
      type: 'server-response',
      rpcId: 'r4',
      result: {
        ok: false,
        error: { code: 'unauthenticated', message: 'bad credentials', details: {} },
      },
    }
    await expect(client.call('account.signin', { email: 'a', password: 'b' }))
      .rejects.toMatchObject({ code: 'unauthenticated' })
  })

  it('surfaces HTTP-level failures as ApiClientError with the status code', async () => {
    const client = new ApiClient({ baseUrl: 'http://localhost:18000', fetchImpl: buildFetch() })
    nextStatus = 502
    nextBody = 'bad gateway'
    await expect(client.call('host.describe', {})).rejects.toBeInstanceOf(ApiClientError)
  })
})

describe('ApiClient respond()', () => {
  it('forwards the bearer token on respond()', async () => {
    const client = new ApiClient({ baseUrl: 'http://localhost:18000', fetchImpl: buildFetch() })
    client.setToken('tkn-respond')
    await client.respond({
      type: 'client-response',
      rpcId: 'rpc-respond',
      result: { ok: true, value: { approved: true } },
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toMatch(/\/api\/respond$/)
    expect(findBearerHeader(calls[0])).toBe('Bearer tkn-respond')
  })

  it('omits the Authorization header after setToken(null)', async () => {
    const client = new ApiClient({ baseUrl: 'http://localhost:18000', fetchImpl: buildFetch() })
    client.setToken('tkn-respond')
    client.setToken(null)
    await client.respond({
      type: 'client-response',
      rpcId: 'rpc-respond',
      result: { ok: true, value: { approved: true } },
    })
    expect(findBearerHeader(calls[0])).toBeUndefined()
  })
})

describe('ApiClient baseUrl', () => {
  it('strips a trailing slash on construction and setBaseUrl', () => {
    const client = new ApiClient({ baseUrl: 'http://localhost:18000/', fetchImpl: buildFetch() })
    expect(client.getBaseUrl()).toBe('http://localhost:18000')
    client.setBaseUrl('http://other.example/')
    expect(client.getBaseUrl()).toBe('http://other.example')
  })
})

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = []
  for await (const value of source) values.push(value)
  return values
}

describe('ApiClient account inference', () => {
  const request = { version: 1 as const, model: 'MiniMax-M3', messages: [{ role: 'user' as const, content: 'hello' }] }

  it('keeps the bearer in Electron and yields a validated terminal NDJSON stream', async () => {
    let authorization: string | null = null
    const frames = [
      { version: 1, type: 'chunk', chunk: { type: 'block-start', index: 0, blockType: 'text' } },
      { version: 1, type: 'chunk', chunk: { type: 'text-delta', index: 0, text: 'ok' } },
      { version: 1, type: 'chunk', chunk: { type: 'block-end', index: 0, block: { type: 'text', text: 'ok' } } },
      { version: 1, type: 'chunk', chunk: { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } } },
      { version: 1, type: 'chunk', chunk: { type: 'finish', reason: { kind: 'stop' } } },
      { version: 1, type: 'done' },
    ]
    const client = new ApiClient({
      baseUrl: 'http://cloud.test',
      fetchImpl: async (_input, init) => {
        authorization = new Headers(init?.headers).get('authorization')
        return new Response(`${frames.map(frame => JSON.stringify(frame)).join('\n')}\n`, {
          headers: { 'content-type': 'application/x-ndjson' },
        })
      },
    })
    client.setToken('account-token')
    const chunks = await collect(client.streamAccountInference(request, new AbortController().signal))
    expect(authorization).toBe('Bearer account-token')
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } })
  })

  it('refuses account inference before a bearer is installed', async () => {
    const client = new ApiClient({ baseUrl: 'http://cloud.test', fetchImpl: buildFetch() })
    await expect(collect(client.streamAccountInference(request, new AbortController().signal)))
      .rejects.toMatchObject({ code: 'ACCOUNT_AUTH_REQUIRED' })
    expect(calls).toHaveLength(0)
  })

  it('rejects a stream that sends done before a finish chunk', async () => {
    const client = new ApiClient({
      baseUrl: 'http://cloud.test',
      fetchImpl: async () => new Response('{"version":1,"type":"done"}\n', {
        headers: { 'content-type': 'application/x-ndjson' },
      }),
    })
    client.setToken('account-token')
    await expect(collect(client.streamAccountInference(request, new AbortController().signal)))
      .rejects.toMatchObject({ code: 'BAD_RESPONSE' })
  })
})
