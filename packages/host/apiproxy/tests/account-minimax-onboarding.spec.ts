import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionTitleService from '@deepseek-ai/dsh-session-title'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import LocalIdentityProvider from '@deepseek-ai/dsh-account-identity'
import type { UserId } from '@deepseek-ai/dsh-account-identity'
import LocalWalletProvider from '@deepseek-ai/dsh-account-wallet'
import LocalUserModelKeyProvider from '@deepseek-ai/dsh-account-model-keys'
import { createApiProxy } from '@deepseek-ai/dsh-host-apiproxy'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'

const roots: string[] = []

function response(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json', ...headers } })
}

function newApiFetch(): typeof fetch {
  let tokenName = ''
  let created = false
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString()
    if (url.endsWith('/user/login')) return response({ success: true, data: { id: 7 } }, { 'set-cookie': 'session=onboarding; Path=/; HttpOnly' })
    if (url.includes('/token/?')) return response({ success: true, data: { items: created ? [{ id: 11, name: tokenName }] : [] } })
    if (url.endsWith('/token/')) {
      created = true
      if (typeof init?.body !== 'string') throw new TypeError('expected a JSON string request body')
      tokenName = (JSON.parse(init.body) as { name: string }).name
      return response({ success: true, data: {} })
    }
    if (url.endsWith('/token/11/key')) return response({ success: true, data: { key: 'new-api-account-token' } })
    return response({ success: false, message: 'unexpected request' })
  })
}

afterEach(async () => {
  vi.unstubAllGlobals()
  while (roots.length > 0) await rm(roots.pop()!, { recursive: true, force: true })
})

describe('account MiniMax onboarding', () => {
  it('creates one account token and 20 CNY wallet credit, then repairs idempotently on sign-in', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-account-onboarding-'))
    roots.push(root)
    const fetchMock = newApiFetch()
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(UserQuestionService)
    await ctx.plugin(SessionTitleService, { fallbackMaxWords: 5, fallbackMaxBytes: 80, maxTitleBytes: 80 })
    await ctx.plugin(LocalIdentityProvider, {
      path: join(root, 'identity.sqlite'),
      sessionTtlSeconds: 3_600,
      bootstrap: { email: 'admin@example.test', password: 'admin-password' },
      invitationPepper: 'account-minimax-onboarding-test-pepper',
    })
    await ctx.plugin(LocalWalletProvider, { path: join(root, 'wallet.sqlite'), welcomeBonusMicros: 20_000_000 })
    await ctx.plugin(LocalUserModelKeyProvider, {
      path: join(root, 'model-keys.sqlite'),
      masterKey: randomBytes(32).toString('base64url'),
      newApi: {
        adminUrl: 'https://new-api.test/api', apiBaseUrl: 'https://new-api.test/v1',
        username: 'admin', password: 'password', userGroup: 'default',
        tokenQuota: 0, tokenUnlimitedQuota: true, tokenExpiresDays: 0,
        modelLimitsEnabled: true, route: 'xiaowei-minimax', model: 'MiniMax-M3',
        inputPriceMicrosPerToken: 1, outputPriceMicrosPerToken: 8,
        timeoutMs: 1_000, retries: 0,
      },
    })
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'xiaowei-minimax', model: 'MiniMax-M3' }),
      cwd: root,
    })
    const email = 'onboarding@example.test'
    const password = 'correct horse battery staple'
    const admin = await ctx.identity.signin({ email: 'admin@example.test', password: 'admin-password' })
    const invitation = await ctx.identity.createInvitation({ ownerId: admin.userId })

    const signup = await api.account.signup({
      rpcId: RpcId('signup'),
      payload: { email, password, displayName: 'Onboarding', invitationCode: invitation.code },
    })
    expect(signup.result.ok).toBe(true)
    if (!signup.result.ok) throw new Error(signup.result.error.message)
    const userId = signup.result.value.userId as UserId
    expect(await ctx.wallet.get({ userId })).toMatchObject({ balanceMicros: 20_000_000 })
    expect(await ctx.userModelKeys.list({ userId })).toHaveLength(1)
    expect(await ctx.userModelKeys.resolveActive({ userId, route: 'xiaowei-minimax' })).toMatchObject({
      token: 'new-api-account-token', model: 'MiniMax-M3',
    })

    const signin = await api.account.signin({ rpcId: RpcId('signin'), payload: { email, password } })
    expect(signin.result.ok).toBe(true)
    expect(await ctx.wallet.get({ userId })).toMatchObject({ balanceMicros: 20_000_000 })
    expect(await ctx.userModelKeys.list({ userId })).toHaveLength(1)
    expect((fetchMock as ReturnType<typeof vi.fn>).mock.calls.filter(call => String(call[0]).endsWith('/token/'))).toHaveLength(1)
  })
})
