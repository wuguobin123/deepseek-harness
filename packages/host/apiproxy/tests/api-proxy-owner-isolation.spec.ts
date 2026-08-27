import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionOwnerId, type Session, type SessionId } from '@deepseek-ai/dsh-session'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionTitleService from '@deepseek-ai/dsh-session-title'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { createApiProxy } from '@deepseek-ai/dsh-host-apiproxy'
import type { ApiProxy, MuxFrame, RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'

const sessionId = (value: string): SessionId => value as SessionId

let nextRpc = 0
function request<P>(payload: P, userId: string): RpcRequest<P> {
  return {
    rpcId: RpcId(`owner-isolation-${String(nextRpc++)}`),
    payload,
    principal: { kind: 'account', userId },
  }
}

async function harness(): Promise<{ ctx: Context; api: ApiProxy }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(SessionTitleService, { fallbackMaxWords: 5, fallbackMaxBytes: 80, maxTitleBytes: 80 })
  return {
    ctx,
    api: createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'p', model: 'm' }),
      cwd: '/tmp',
    }),
  }
}

function createOwnedSession(ctx: Context, id: string, ownerId: string): Session {
  const session = ctx.sessions.create(sessionId(id), { meta: { cwd: '/tmp', ownerId: SessionOwnerId(ownerId) } })
  session.append('turn/start', { turn: 0 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: `${ownerId} prompt` }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  ctx.agents.register({ id: session.id, session, status: 'idle', ctx, inbox: { hasPending: false } } as Agent)
  return session
}

function expectSessionNotFound(response: { result: { ok: boolean; error?: { code: string } } }): void {
  expect(response.result.ok).toBe(false)
  expect(response.result.error?.code).toBe('session-not-found')
}

describe('account session ownership', () => {
  it('does not allow account sessions to select a preset or host cwd', async () => {
    const { api } = await harness()
    expect((await api.sessions.create(request({ agentPreset: 'standard' }, 'user-a'))).result).toMatchObject({
      ok: false,
      error: { code: 'bad-request' },
    })
    expect((await api.sessions.create(request({ cwd: '/tmp' }, 'user-a'))).result).toMatchObject({
      ok: false,
      error: { code: 'bad-request' },
    })
    expect((await api.host.openPath(request({ path: '/tmp/host-file' }, 'user-a'), new AbortController().signal)).result).toMatchObject({
      ok: false,
      error: { code: 'unauthenticated' },
    })
    expect((await api.agentPresets.select(request({ sessionId: sessionId('missing'), agentPreset: 'standard' }, 'user-a'))).result).toMatchObject({
      ok: false,
      error: { code: 'unauthenticated' },
    })
  })

  it('isolates list, history, and mutations between account principals', async () => {
    const { ctx, api } = await harness()
    const a = createOwnedSession(ctx, 'owner-a-session', 'user-a')
    const b = createOwnedSession(ctx, 'owner-b-session', 'user-b')
    expect(a.header.ownerId).toBe('user-a')
    expect(b.header.ownerId).toBe('user-b')

    const aList = await api.sessions.list(request({}, 'user-a'))
    const bList = await api.sessions.list(request({}, 'user-b'))
    expect(aList.result.ok && aList.result.value.items.map(item => item.sessionId)).toEqual([a.id])
    expect(bList.result.ok && bList.result.value.items.map(item => item.sessionId)).toEqual([b.id])

    expectSessionNotFound(await api.sessions.history(request({ sessionId: a.id }, 'user-b')))
    expectSessionNotFound(await api.sessions.rename(request({ sessionId: a.id, title: 'stolen' }, 'user-b')))

    const ownHistory = await api.sessions.history(request({ sessionId: a.id }, 'user-a'))
    expect(ownHistory.result.ok).toBe(true)
    expect((await api.sessions.history(request({ sessionId: b.id }, 'user-a'))).result).toMatchObject({
      ok: false,
      error: { code: 'session-not-found' },
    })
  })

  it('delivers mux frames only for the authenticated owner', async () => {
    const { ctx, api } = await harness()
    const a = createOwnedSession(ctx, 'owner-a-stream', 'user-a')
    const b = createOwnedSession(ctx, 'owner-b-stream', 'user-b')
    const abort = new AbortController()
    const frames = (async () => {
      const received: MuxFrame[] = []
      for await (const envelope of api.events.mux(request({}, 'user-b'), abort.signal)) {
        received.push(envelope.payload)
        if (envelope.payload.type === 'session/event') {
          abort.abort()
        }
      }
      return received
    })()

    a.append('turn/end', { turn: 0, reason: { kind: 'completed' } })
    b.append('turn/end', { turn: 0, reason: { kind: 'completed' } })

    const received = await frames
    expect(received.some(frame => 'sessionId' in frame && frame.sessionId === a.id)).toBe(false)
    expect(received.some(frame => 'sessionId' in frame && frame.sessionId === b.id)).toBe(true)
  })

  it('derives wallet and key reads from the account principal and rejects management calls', async () => {
    const { ctx, api } = await harness()
    const walletUsers: string[] = []
    const keyUsers: string[] = []
    ctx.provide('wallet', {
      get: async ({ userId }: { userId: string }) => {
        walletUsers.push(userId)
        return { userId, balanceMicros: 20_000_000, updatedAt: 1 }
      },
      listLedger: async ({ userId }: { userId: string }) => {
        walletUsers.push(userId)
        return []
      },
      credit: vi.fn(),
      debit: vi.fn(),
      setQuota: vi.fn(),
      refreshDaily: vi.fn(),
      grantWelcomeBonus: vi.fn(),
    } as never)
    ctx.provide('userModelKeys', {
      list: async ({ userId }: { userId: string }) => {
        keyUsers.push(userId)
        return []
      },
      provision: vi.fn(),
      revoke: vi.fn(),
    } as never)
    expect((await api.wallet.get(request({ userId: 'user-b' }, 'user-a') as never)).result.ok).toBe(true)
    expect((await api.wallet.listLedger(request({ userId: 'user-b' }, 'user-a') as never)).result.ok).toBe(true)
    expect((await api.modelKeys.list(request({ userId: 'user-b' }, 'user-a') as never)).result.ok).toBe(true)
    expect(walletUsers).toEqual(['user-a', 'user-a'])
    expect(keyUsers).toEqual(['user-a'])

    const denied = await Promise.all([
      api.wallet.credit(request({ userId: 'user-a', amountMicros: 1, reason: 'topup' }, 'user-a') as never),
      api.wallet.debit(request({ userId: 'user-a', amountMicros: 1, reason: 'debit' }, 'user-a') as never),
      api.wallet.setQuota(request({ userId: 'user-a', balanceMicros: 1, reason: 'set-quota' }, 'user-a') as never),
      api.wallet.refreshDaily(request({ userId: 'user-a', idempotencyKey: 'today' }, 'user-a') as never),
      api.wallet.grantWelcomeBonus(request({ userId: 'user-a' }, 'user-a') as never),
      api.modelKeys.provision(request({ userId: 'user-a' }, 'user-a') as never),
      api.modelKeys.revoke(request({ keyId: 'mk-a' }, 'user-a') as never),
    ])
    expect(denied.every(response => !response.result.ok && response.result.error.code === 'unauthenticated')).toBe(true)
  })

  it('requires account principals and strips custom-model ownership and keys from responses', async () => {
    const { ctx, api } = await harness()
    const customModelId = 'cm_0123456789abcdef'
    const createCustom = vi.fn(async (input: { userId: string }) => ({ customModelId, userId: input.userId as never, label: 'remote', api: 'openai-responses' as const, baseURL: 'https://api.example.com/v1/', upstreamModel: 'm', created: 1, revoked: null }))
    ctx.provide('userModelKeys', {
      createCustom,
      listCustom: async ({ userId }: { userId: string }) => [{ customModelId, userId: userId as never, label: 'remote', api: 'openai-responses' as const, baseURL: 'https://api.example.com/v1/', upstreamModel: 'm', created: 1, revoked: null }],
      removeCustom: async () => ({ removed: true }),
    } as never)
    const account = request({ label: 'remote', api: 'openai-responses' as const, baseURL: 'https://api.example.com/v1', upstreamModel: 'm', apiKey: 'secret' }, 'user-a')
    expect((await api.customModels.create(account)).result).toMatchObject({ ok: true, value: { customModelId } })
    expect((await api.customModels.create({ ...account, principal: { kind: 'local' } })).result).toMatchObject({ ok: false, error: { code: 'unauthenticated' } })
    expect((await api.customModels.list(request({}, 'user-a'))).result).toMatchObject({ ok: true, value: { items: [{ customModelId }] } })
    expect(createCustom).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-a' }))
  })
})
