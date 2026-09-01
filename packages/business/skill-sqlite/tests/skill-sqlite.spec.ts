import { afterEach, describe, expect, it } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { BusinessSkillError, type BusinessSkillManifest } from '@deepseek-ai/dsh-business-skill'
import { openBusinessSkillDatabase, SqliteBusinessSkillStore } from '../src/index.ts'

const manifest = (version: string): BusinessSkillManifest => ({
  name: 'xiaowei-metrics',
  version,
  description: 'Read Xiaowei account metrics.',
  connectionIds: ['https://business.example/api/'],
  credentialRefs: ['XIAOWEI_BUSINESS_API_TOKEN'],
  operations: [{
    id: 'registered-accounts',
    method: 'GET',
    path: '/metrics/registered-accounts',
    input: { type: 'object' },
    output: {
      type: 'object', properties: { count: { type: 'integer' } }, required: ['count'], additionalProperties: false,
    },
    permission: 'metrics.accounts.read',
    connection: 'https://business.example/api/',
    credentialRef: 'XIAOWEI_BUSINESS_API_TOKEN',
    risk: 'R1',
  }],
})

describe('SQLite business Skill store', () => {
  let db: DatabaseSync | undefined
  afterEach(() => { db?.close(); db = undefined })

  it('publishes immutable revisions, enforces CAS, and rolls back atomically', async () => {
    db = await openBusinessSkillDatabase(':memory:')
    const store = new SqliteBusinessSkillStore(db)
    expect((await store.publish('user-a', manifest('1.0.0'), 0)).revision).toBe(1)
    expect((await store.publish('user-a', manifest('1.1.0'), 1)).revision).toBe(2)
    await expect(store.publish('user-a', manifest('1.2.0'), 1)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
    expect(await store.list('user-b')).toEqual([])
    expect((await store.list('user-a')).map(item => [item.revision, item.active])).toEqual([[2, true], [1, false]])
    expect((await store.rollback('user-a', 'xiaowei-metrics', 1, 2)).manifest.version).toBe('1.0.0')
    expect((await store.resolve('user-a', 'xiaowei-metrics'))?.revision).toBe(1)
  })

  it('rejects identity fields anywhere in manifest-controlled data', async () => {
    db = await openBusinessSkillDatabase(':memory:')
    const store = new SqliteBusinessSkillStore(db)
    const invalid = structuredClone(manifest('1.0.0')) as unknown as Record<string, unknown>
    invalid.operations = [{ ...(manifest('1.0.0').operations[0] as object), input: { type: 'object', properties: { userId: { type: 'string' } } } }]
    expect(() => store.validate('user-a', invalid)).toThrow(BusinessSkillError)
    expect(() => store.validate('user-a', invalid)).toThrow(/reserved field/)
  })

  it('rejects unsupported operation schemas before publication', async () => {
    db = await openBusinessSkillDatabase(':memory:')
    const store = new SqliteBusinessSkillStore(db)
    const invalid = structuredClone(manifest('1.0.0')) as unknown as Record<string, unknown>
    invalid.operations = [{
      ...(manifest('1.0.0').operations[0] as object),
      input: { type: 'object', properties: { query: { $ref: '#/definitions/query' } } },
    }]
    expect(() => store.validate('user-a', invalid)).toThrow(/invalid operation .* schema/)
  })
})
