import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionOwnerId, type SessionId } from '@deepseek-ai/dsh-session'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import SessionTitleService from '@deepseek-ai/dsh-session-title'
import { createApiProxy } from '@deepseek-ai/dsh-host-apiproxy'
import { RpcId, type RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import type { ArtifactView } from '@deepseek-ai/dsh-artifact'
import { ArtifactError } from '@deepseek-ai/dsh-artifact'

const sid = (value: string): SessionId => value as SessionId
const aid = (value: string): ArtifactView['artifactId'] => value as ArtifactView['artifactId']

describe('artifact RPC account authorization', () => {
  it('allows own session only, hides bare and foreign ids, and preserves local access', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(UserQuestionService)
    await ctx.plugin(SessionTitleService, { fallbackMaxWords: 5, fallbackMaxBytes: 80, maxTitleBytes: 80 })
    const own = ctx.sessions.create(sid('artifact-own'), { meta: { cwd: '/tmp', ownerId: SessionOwnerId('user-a') } })
    const foreign = ctx.sessions.create(sid('artifact-foreign'), { meta: { cwd: '/tmp', ownerId: SessionOwnerId('user-b') } })
    const rows: ArtifactView[] = [
      { artifactId: aid('artifact-a'), kind: 'html', source: 'tool-html', mediaType: 'text/html', bytes: 1, sessionId: own.id, createdAt: 'now' },
      { artifactId: aid('artifact-b'), kind: 'doc', source: 'tool-doc', mediaType: 'text/html', bytes: 1, sessionId: foreign.id, createdAt: 'now' },
    ]
    const registry = {
      list: async (filter?: { sessionId?: SessionId }) => filter?.sessionId === undefined
        ? rows
        : rows.filter(row => row.sessionId === filter.sessionId),
      read: async ({ artifactId }: { artifactId: ArtifactView['artifactId'] }) => {
        const view = rows.find(row => row.artifactId === artifactId)
        if (view === undefined) throw new ArtifactError('missing', 'ARTIFACT_NOT_FOUND')
        return { view, data: new Uint8Array([1]) }
      },
      remove: async ({ artifactId }: { artifactId: ArtifactView['artifactId'] }) => { rows.splice(rows.findIndex(row => row.artifactId === artifactId), 1) },
    }
    ctx.provide('artifactRegistry', registry as never)
    const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })
    let n = 0
    const req = <P>(payload: P, userId?: string): RpcRequest<P> => ({ rpcId: RpcId(`artifact-${++n}`), payload, ...(userId === undefined ? {} : { principal: { kind: 'account', userId } }) })
    expect((await api.artifactRegistry.list(req({ sessionId: own.id }, 'user-a'))).result).toMatchObject({ ok: true, value: { items: [{ artifactId: 'artifact-a' }] } })
    expect((await api.artifactRegistry.list(req({ sessionId: own.id, kind: 'doc' }, 'user-a'))).result).toMatchObject({ ok: true, value: { items: [] } })
    expect((await api.artifactRegistry.list(req({}, 'user-a'))).result).toMatchObject({ ok: false, error: { code: 'unauthenticated' } })
    expect((await api.artifactRegistry.list(req({ sessionId: foreign.id }, 'user-a'))).result).toMatchObject({ ok: false, error: { code: 'session-not-found' } })
    expect((await api.artifactRegistry.read(req({ artifactId: aid('artifact-b') }, 'user-a'))).result).toMatchObject({ ok: false, error: { code: 'artifact-not-found' } })
    expect((await api.artifactRegistry.remove(req({ artifactId: aid('artifact-b') }, 'user-a'))).result).toMatchObject({ ok: false, error: { code: 'artifact-not-found' } })
    expect((await api.artifactRegistry.read(req({ artifactId: aid('missing') }, 'user-a'))).result).toMatchObject({ ok: false })
    expect((await api.artifactRegistry.read(req({ artifactId: aid('artifact-a') }))).result).toMatchObject({ ok: true })
    expect((await api.artifactRegistry.remove(req({ artifactId: aid('artifact-a') }))).result).toMatchObject({ ok: true, value: { removed: true } })
  })
})
