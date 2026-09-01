import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import BusinessSkillService, {
  type BusinessSkillManifest, type SkillStore, type SkillVersion,
} from '@deepseek-ai/dsh-business-skill'
import BusinessConnectorRegistry from '@deepseek-ai/dsh-business-connector'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionStore from '@deepseek-ai/dsh-session'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import type { RpcRequest } from '../src/api/rpc.ts'
import { RpcId } from '../src/api/rpc.ts'
import { createApiProxy } from '../src/api-proxy.ts'

const manifest: BusinessSkillManifest = {
  name: 'xiaowei-metrics', version: '1.0.0', description: 'Read Xiaowei metrics.',
  connectionIds: ['https://business.example/api/'], credentialRefs: [],
  operations: [{
    id: 'registered-accounts', method: 'GET', path: '/metrics/accounts', input: { type: 'object' },
    output: { type: 'object' }, permission: 'metrics.accounts.read',
    connection: 'https://business.example/api/', risk: 'R1',
  }],
}

function request<P>(payload: P, userId?: string): RpcRequest<P> {
  return {
    rpcId: RpcId('business-skill-test'),
    payload,
    ...(userId === undefined ? {} : { principal: { kind: 'account' as const, userId } }),
  }
}

describe('business Skill account RPC', () => {
  it('derives owner identity exclusively from the authenticated principal', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(UserQuestionService)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(BusinessSkillService)
    await ctx.plugin(BusinessConnectorRegistry)
    ctx.businessConnectors.register({ id: 'https://business.example/api/', execute: async () => ({}) })
    const publishedOwners: string[] = []
    let active: SkillVersion | null = null
    const store: SkillStore = {
      validate: (_ownerId, raw) => raw as BusinessSkillManifest,
      publish: async (ownerId, value) => {
        publishedOwners.push(ownerId)
        active = { ownerId, revision: 1, manifest: value, active: true }
        return active
      },
      list: async ownerId => active?.ownerId === ownerId ? [active] : [],
      get: async () => active,
      disable: async () => {},
      rollback: async () => {
        if (active === null) throw new Error('missing revision')
        return active
      },
      resolve: async () => active,
    }
    ctx.businessSkill.registerProvider(store)
    const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })
    const anonymous = await api.businessSkills.publish(request({ manifestText: JSON.stringify(manifest) }))
    expect(anonymous.result).toMatchObject({ ok: false, error: { code: 'unauthenticated' } })
    const response = await api.businessSkills.publish(request({ manifestText: JSON.stringify(manifest) }, 'trusted-user'))
    expect(response.result).toMatchObject({ ok: true, value: { revision: 1 } })
    expect(publishedOwners).toEqual(['trusted-user'])
    expect(JSON.stringify(response)).not.toContain('trusted-user')

    const unapproved = structuredClone(manifest) as BusinessSkillManifest & {
      connectionIds: string[]
      operations: Array<BusinessSkillManifest['operations'][number] & { connection: string }>
    }
    unapproved.connectionIds = ['https://unapproved.example/api/']
    unapproved.operations[0]!.connection = 'https://unapproved.example/api/'
    const rejected = await api.businessSkills.publish(request({
      manifestText: JSON.stringify(unapproved),
    }, 'trusted-user'))
    expect(rejected.result).toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(publishedOwners).toEqual(['trusted-user'])
  })
})
