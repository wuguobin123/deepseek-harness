import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import BusinessSkillService, { type BusinessSkillManifest, type SkillStore, type SkillVersion } from '@deepseek-ai/dsh-business-skill'
import { BusinessConnectorRegistry, type ConnectorRequest } from '@deepseek-ai/dsh-business-connector'
import { BusinessSkillRuntime, inject } from '../src/index.ts'

const manifest: BusinessSkillManifest = {
  name: 'xiaowei-metrics', version: '1.0.0', description: 'Read metrics.',
  connectionIds: ['business-api'], credentialRefs: ['BUSINESS_TOKEN'],
  operations: [{
    id: 'share-code-usage', method: 'GET', path: '/metrics/share-codes', input: { type: 'object' },
    output: {
      type: 'object', properties: { count: { type: 'integer' } }, required: ['count'], additionalProperties: false,
    }, permission: 'metrics.share-codes.read',
    connection: 'business-api', risk: 'R1',
  }],
}
const version: SkillVersion = { ownerId: 'platform-user', revision: 1, manifest, active: true }

describe('business Skill runtime', () => {
  it('declares the credential service used by configured operations', () => {
    expect(inject).toContain('credentials')
  })

  it('uses only trusted principal identity and rejects identity-shaped model input', async () => {
    const ctx = new Context()
    await ctx.plugin(BusinessSkillService)
    await ctx.plugin(BusinessConnectorRegistry)
    const store: SkillStore = {
      validate: () => manifest,
      publish: async () => version,
      list: async () => [version],
      get: async () => version,
      disable: async () => {},
      rollback: async () => version,
      resolve: async ownerId => ownerId === 'platform-user' ? version : null,
    }
    ctx.businessSkill.registerProvider(store)
    const execute = vi.fn(async (request: ConnectorRequest) => (
      { count: request.principal.userId === 'platform-user' ? 3 : 0 }
    ))
    ctx.businessConnectors.register({ id: 'business-api', execute })
    const runtime = new BusinessSkillRuntime({ skills: ctx.businessSkill, connectors: ctx.businessConnectors })
    await expect(runtime.call(
      { principal: { userId: 'platform-user' } },
      { skill: 'xiaowei-metrics', operation: 'share-code-usage', input: {} },
    )).resolves.toEqual({ count: 3 })
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ principal: { userId: 'platform-user' } }))
    await expect(runtime.call(
      { principal: { userId: 'platform-user' } },
      { skill: 'xiaowei-metrics', operation: 'share-code-usage', input: [] },
    )).rejects.toMatchObject({ code: 'INPUT_INVALID' })
    expect(execute).toHaveBeenCalledTimes(1)
    await expect(runtime.call(
      { principal: { userId: 'platform-user' } },
      { skill: 'xiaowei-metrics', operation: 'share-code-usage', input: { userId: 'attacker' } },
    )).rejects.toMatchObject({ code: 'RESERVED_FIELD' })
  })
})
