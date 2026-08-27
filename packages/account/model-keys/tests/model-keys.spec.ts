import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Config, LocalUserModelKeyProvider } from '../src/index.ts'

const roots: string[] = []
const masterKey = randomBytes(32).toString('base64url')
const user = 'u-alice' as never
function response(body: unknown, status = 200, headers: Record<string, string> = {}): Response { return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } }) }
function requestUrl(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : input.toString()
}

function requestBody(init: RequestInit | undefined): string {
  if (typeof init?.body !== 'string') throw new TypeError('expected a JSON string request body')
  return init.body
}

async function boot(fetchImpl: typeof fetch): Promise<{ ctx: Context; databasePath: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-model-keys-')); roots.push(root); vi.stubGlobal('fetch', fetchImpl)
  const databasePath = join(root, 'keys.sqlite')
  const ctx = new Context(); await ctx.plugin(LocalUserModelKeyProvider, { path: join(root, 'keys.sqlite'), masterKey, newApi: {
    adminUrl: 'https://new-api.test/api', apiBaseUrl: 'https://new-api.test/v1', username: 'admin', password: 'pw', userGroup: 'default', tokenQuota: 100, tokenUnlimitedQuota: true, tokenExpiresDays: 0, modelLimitsEnabled: true, route: 'minimax', model: 'MiniMax-M2', inputPriceMicrosPerToken: 2, outputPriceMicrosPerToken: 4, timeoutMs: 1000, retries: 1,
  } }); return { ctx, databasePath }
}
function newApiFetch() {
  let created = false
  let tokenName = ''
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input)
    if (url.endsWith('/user/login')) {
      return response({ success: true, data: { id: 7 } }, 200, { 'set-cookie': 'sid=abc' })
    }
    if (url.includes('/token/?')) {
      return response({
        success: true,
        data: created ? { items: [{ id: 9, name: tokenName, created_time: 2 }] } : { items: [] },
      })
    }
    if (url.endsWith('/token/')) {
      created = true
      tokenName = (JSON.parse(requestBody(init)) as { name: string }).name
      return response({ success: true, data: null })
    }
    if (url.endsWith('/token/9/key')) return response({ success: true, data: { key: 'sk_real_token' } })
    if (init?.method === 'DELETE') return response({ success: true, data: {} })
    return response({ success: false }, 400)
  })
}
afterEach(async () => { vi.unstubAllGlobals(); while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }) })

describe('New-API model credentials', () => {
  it('stores custom models encrypted, enforces ownership, and decrypts after restart', async () => {
    const { ctx, databasePath } = await boot(vi.fn(async () => response({ success: true })))
    const created = await ctx.userModelKeys.createCustom({ userId: user, label: 'remote', api: 'openai-responses', baseURL: 'https://api.example.com/v1', upstreamModel: 'model-a', apiKey: '  sk-custom  ' })
    expect(created).not.toHaveProperty('apiKey')
    expect((await ctx.userModelKeys.listCustom({ userId: user }))[0]).not.toHaveProperty('apiKey')
    expect((await readFile(databasePath)).includes(Buffer.from('sk-custom'))).toBe(false)
    expect(await ctx.userModelKeys.resolveCustom({ userId: 'u-other' as never, customModelId: created.customModelId })).toBeUndefined()
    expect(await ctx.userModelKeys.removeCustom({ userId: 'u-other' as never, customModelId: created.customModelId })).toEqual({ removed: false })
    expect((await ctx.userModelKeys.resolveCustom({ userId: user, customModelId: created.customModelId }))!.apiKey).toBe('sk-custom')
    await ctx.fiber.dispose()
    const reopened = new Context(); await reopened.plugin(LocalUserModelKeyProvider, { path: databasePath, masterKey, newApi: {
      adminUrl: 'https://new-api.test/api', apiBaseUrl: 'https://new-api.test/v1', username: 'admin', password: 'pw', userGroup: 'default', tokenQuota: 100, tokenUnlimitedQuota: true, tokenExpiresDays: 0, modelLimitsEnabled: true, route: 'minimax', model: 'MiniMax-M2', inputPriceMicrosPerToken: 2, outputPriceMicrosPerToken: 4, timeoutMs: 1000, retries: 1,
    } })
    expect((await reopened.userModelKeys.resolveCustom({ userId: user, customModelId: created.customModelId }))!.apiKey).toBe('sk-custom')
    expect(await reopened.userModelKeys.removeCustom({ userId: user, customModelId: created.customModelId })).toEqual({ removed: true })
    expect(await reopened.userModelKeys.resolveCustom({ userId: user, customModelId: created.customModelId })).toBeUndefined()
  })

  it('rejects unsafe custom model keys and URL components', async () => {
    const { ctx } = await boot(vi.fn(async () => response({ success: true })))
    const base = { userId: user, label: 'x', api: 'openai-completions' as const, upstreamModel: 'm' }
    for (const apiKey of ['', 'bad\nkey']) await expect(ctx.userModelKeys.createCustom({ ...base, baseURL: 'https://api.example.com', apiKey })).rejects.toThrow()
    await expect(ctx.userModelKeys.createCustom({ ...base, baseURL: 'https://api.example.com', apiKey: 'base64==' })).resolves.toMatchObject({ upstreamModel: 'm' })
    for (const baseURL of ['http://api.example.com', 'https://user:pass@api.example.com', 'https://api.example.com/#x', 'https://localhost/v1', 'https://127.0.0.1/v1']) await expect(ctx.userModelKeys.createCustom({ ...base, baseURL, apiKey: 'sk-ok' })).rejects.toThrow()
  })

  it('enforces the active custom model quota', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-custom-quota-')); roots.push(root)
    const ctx = new Context(); await ctx.plugin(LocalUserModelKeyProvider, { path: join(root, 'keys.sqlite'), masterKey, maxCustomModels: 1 })
    const input = { userId: user, label: 'x', api: 'openai-completions' as const, baseURL: 'https://api.example.com', upstreamModel: 'm', apiKey: 'sk-ok' }
    await ctx.userModelKeys.createCustom(input)
    await expect(ctx.userModelKeys.createCustom(input)).rejects.toThrow('limit')
  })
  it('rejects empty deployment secrets and endpoints at load configuration', () => {
    expect(() => Config({ path: ':memory:', masterKey: '' })).toThrow()
    expect(() => Config({ path: ':memory:', masterKey, newApi: {
      adminUrl: '', apiBaseUrl: '', username: '', password: '', userGroup: 'default', tokenQuota: 0,
      tokenUnlimitedQuota: true, tokenExpiresDays: 0, modelLimitsEnabled: true, route: 'minimax', model: 'MiniMax-M3',
      inputPriceMicrosPerToken: 1, outputPriceMicrosPerToken: 8, timeoutMs: 1_000, retries: 0,
    } })).toThrow()
  })
  it('creates through login/list/create/key and keeps plaintext off disk and RPC metadata', async () => {
    const fetchMock = newApiFetch()
    const { ctx, databasePath } = await boot(fetchMock)
    const key = await ctx.userModelKeys.provision({ userId: user })
    expect(key).not.toHaveProperty('keyValue')
    expect(key.providerRoute).toBe('minimax')
    const calls = fetchMock.mock.calls
    expect(calls[1]![1]?.headers).toMatchObject({ cookie: 'sid=abc', 'New-Api-User': '7' })
    expect(requestBody(calls[2]![1])).not.toContain('remain_quota')
    expect(await ctx.userModelKeys.resolveActive({ userId: user })).toMatchObject({ token: 'sk_real_token', apiBaseUrl: 'https://new-api.test/v1', inputPriceMicrosPerToken: 2, outputPriceMicrosPerToken: 4 })
    expect((await readFile(databasePath)).includes(Buffer.from('sk_real_token'))).toBe(false)
  })

  it('serializes concurrent ensure calls and reuses the active row', async () => {
    const fetchMock = newApiFetch()
    const { ctx } = await boot(fetchMock)
    const [first, second] = await Promise.all([
      ctx.userModelKeys.provision({ userId: user }),
      ctx.userModelKeys.provision({ userId: user }),
    ])
    expect(second.keyId).toBe(first.keyId)
    expect(fetchMock.mock.calls.filter(call => requestUrl(call[0]).endsWith('/token/'))).toHaveLength(1)
  })

  it('uses a key returned directly by create without a follow-up lookup', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input)
      if (url.endsWith('/user/login')) return response({ success: true, data: { id: 7 } }, 200, { 'set-cookie': 'sid=abc; Path=/; HttpOnly' })
      if (url.includes('/token/?')) return response({ success: true, data: { items: [] } })
      if (url.endsWith('/token/')) return response({ success: true, data: { id: 12, key: 'sk_direct' } })
      return response({ success: false }, 404)
    })
    const { ctx } = await boot(fetchMock)
    await ctx.userModelKeys.provision({ userId: user })
    expect(await ctx.userModelKeys.resolveActive({ userId: user })).toMatchObject({ token: 'sk_direct' })
    expect(fetchMock.mock.calls).toHaveLength(3)
  })

  it('updates last-used metadata and revokes the upstream token', async () => {
    const fetchMock = newApiFetch()
    const { ctx } = await boot(fetchMock)
    const key = await ctx.userModelKeys.provision({ userId: user })
    await ctx.userModelKeys.resolveActive({ userId: user })
    expect((await ctx.userModelKeys.list({ userId: user }))[0]!.lastUsedAt).not.toBeNull()
    expect(await ctx.userModelKeys.revoke({ keyId: key.keyId })).toEqual({ revoked: true })
    expect(await ctx.userModelKeys.resolveActive({ userId: user })).toBeUndefined()
    expect(fetchMock.mock.calls.some(call => requestUrl(call[0]).endsWith('/token/9'))).toBe(true)
  })

  it('does not retry non-transient HTTP rejection', async () => {
    const fetchMock = vi.fn(async () => response({ success: false }, 401))
    const { ctx } = await boot(fetchMock)
    await expect(ctx.userModelKeys.provision({ userId: user })).rejects.toThrow('401')
    expect(fetchMock.mock.calls).toHaveLength(1)
  })

  it('retries a transient server failure', async () => {
    let attempts = 0
    const fallback = newApiFetch()
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (attempts++ === 0) return response({}, 500)
      return fallback(input, init)
    })
    const { ctx } = await boot(fetchMock)
    await ctx.userModelKeys.provision({ userId: user })
    expect(fetchMock.mock.calls.length).toBeGreaterThan(4)
  })

  it('fails closed on business rejection', async () => {
    const fetchMock = vi.fn(async () => response({ success: false, message: 'denied' }))
    const { ctx } = await boot(fetchMock)
    await expect(ctx.userModelKeys.provision({ userId: user })).rejects.toThrow('denied')
    expect(fetchMock.mock.calls).toHaveLength(1)
  })
})
