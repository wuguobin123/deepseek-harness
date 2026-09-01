import { afterEach, describe, expect, it } from 'vitest'
import { createServer, request as httpRequest, type Server } from 'node:http'
import { execFileSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BusinessGateway, subjectHash, validateConfig, type GatewayConfig } from '../src/index.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function operation(
  id: string,
  path: string,
  action: 'registered-account-count' | 'registered-user-page' | 'consumed-invitation-count' | 'unconsumed-invitation-count',
  permission: string,
) {
  return {
    id,
    path,
    provider: 'xiaowei-identity' as const,
    action,
    permission,
    ownerScoped: action !== 'registered-account-count' && action !== 'registered-user-page',
  }
}

function fixture(includeUnused = true, includeDetails = false) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-gateway-'))
  roots.push(root)
  const dbPath = join(root, 'identity.sqlite')
  const db = new DatabaseSync(dbPath)
  db.exec('CREATE TABLE users (user_id TEXT PRIMARY KEY, email TEXT NOT NULL, password_hash TEXT NOT NULL, display_name TEXT, created_at INTEGER NOT NULL); CREATE TABLE invitations (owner_id TEXT, consumed_at INTEGER)')
  const insertUser = db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?)')
  insertUser.run('u1', 'first@example.test', 'hash-one', 'First User', Date.UTC(2026, 7, 1))
  insertUser.run('u2', 'second@example.test', 'hash-two', 'Second User', Date.UTC(2026, 7, 2))
  if (includeDetails) {
    for (let index = 3; index <= 12; index += 1) {
      insertUser.run(`u${index}`, `user${index}@example.test`, `hash-${index}`, `User ${index}`, Date.UTC(2026, 7, index))
    }
  }
  db.prepare('INSERT INTO invitations VALUES (?, ?)').run('u1', 1)
  db.prepare('INSERT INTO invitations VALUES (?, ?)').run('u1', null)
  db.prepare('INSERT INTO invitations VALUES (?, ?)').run('u2', null)
  db.close()
  const configPath = join(root, 'config.json')
  const auditPath = join(root, 'audit.jsonl')
  const operations = [
    operation('registered', '/metrics/registered-accounts', 'registered-account-count', 'metrics.accounts.read'),
    operation('used', '/metrics/share-code-usage', 'consumed-invitation-count', 'metrics.share-codes.read'),
    ...(includeUnused ? [operation('unused', '/metrics/share-code-unused', 'unconsumed-invitation-count', 'metrics.share-codes.available.read')] : []),
    ...(includeDetails ? [operation('registered-user-details', '/metrics/registered-user-details', 'registered-user-page', 'users.details.read')] : []),
  ]
  const permissions = ['metrics.accounts.read', 'metrics.share-codes.read', ...(includeUnused ? ['metrics.share-codes.available.read'] : []), ...(includeDetails ? ['users.details.read'] : [])]
  const config: GatewayConfig = { revision: 1, operations, grants: [{ subjectHash: subjectHash('u1'), permissions }] }
  writeFileSync(configPath, JSON.stringify(config))
  return { root, dbPath, configPath, auditPath, config }
}

async function start(includeUnused = true, auditPath?: string, env: NodeJS.ProcessEnv = { XIAOWEI_BUSINESS_API_TOKEN: 'service-secret' }, includeDetails = false) {
  const f = fixture(includeUnused, includeDetails)
  const gateway = new BusinessGateway({
    configPath: f.configPath,
    databaseRoot: f.root,
    databasePath: f.dbPath,
    auditPath: auditPath ?? f.auditPath,
    env,
    now: () => new Date('2026-09-01T00:00:00.000Z'),
  })
  const server = createServer((req, res) => { gateway.handle(req, res) })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('server address missing')
  const close = async (): Promise<void> => {
    gateway.close()
    await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
  }
  return { ...f, gateway, server, origin: `http://127.0.0.1:${address.port}`, close }
}

const headers = (permission: string, userId = 'u1') => ({
  authorization: 'Bearer service-secret',
  'x-xiaowei-user-id': userId,
  'x-xiaowei-required-permission': permission,
})

async function rawBodyRequest(server: Server, path: string, permission = 'metrics.accounts.read'): Promise<{ status: number; body: string }> {
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('server address missing')
  return await new Promise((resolve, reject) => {
    const req = httpRequest({
      host: '127.0.0.1',
      port: address.port,
      path,
      method: 'GET',
      headers: { ...headers(permission), 'content-length': '1' },
    }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk: string) => { body += chunk })
      response.on('end', () => { resolve({ status: response.statusCode ?? 0, body }) })
    })
    req.on('error', reject)
    req.end('x')
  })
}

describe('business gateway configuration', () => {
  it('accepts only registered actions and safe owner scope', () => {
    const valid = fixture().config
    expect(validateConfig(valid)).toEqual(valid)
    const cases: unknown[] = [
      { ...valid, serviceBearer: 'secret' },
      { ...valid, operations: [{ ...valid.operations[0], url: 'https://example.test' }] },
      { ...valid, operations: [{ ...valid.operations[0], provider: 'generic-http' }] },
      { ...valid, operations: [{ ...valid.operations[0], action: 'raw-sql' }] },
      { ...valid, operations: [{ ...valid.operations[0], ownerScoped: true }] },
      { ...valid, operations: [{ ...valid.operations[1], ownerScoped: false }] },
      { ...valid, operations: [valid.operations[0], { ...valid.operations[1], id: valid.operations[0]!.id }] },
      { ...valid, operations: [valid.operations[0], { ...valid.operations[1], path: valid.operations[0]!.path }] },
      { ...valid, operations: [{ ...valid.operations[0], path: '/v1/query' }] },
    ]
    for (const candidate of cases) expect(() => validateConfig(candidate)).toThrow(/invalid gateway configuration/)
  })

  it('keeps database location outside the hot configuration surface', () => {
    const f = fixture()
    expect(() => new BusinessGateway({
      configPath: f.configPath,
      databaseRoot: f.root,
      databasePath: join(f.root, '..', 'identity.sqlite'),
      auditPath: f.auditPath,
      env: { XIAOWEI_BUSINESS_API_TOKEN: 'service-secret' },
    })).toThrow(/databasePath must be below databaseRoot/)
  })

  it('seeds revision three without dropping any existing operation', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-gateway-seed-'))
    roots.push(root)
    const sourceEnv = join(root, 'source.env')
    const configPath = join(root, 'config.json')
    const gatewayEnv = join(root, 'gateway.env')
    writeFileSync(sourceEnv, `XIAOWEI_BUSINESS_API_TOKEN=${'t'.repeat(32)}\nXIAOWEI_BUSINESS_METRICS_GRANTS={"u1":["metrics.accounts.read","metrics.share-codes.read"]}\n`)
    execFileSync(process.execPath, [
      fileURLToPath(new URL('../deploy/seed-config.mjs', import.meta.url)),
      sourceEnv,
      configPath,
      gatewayEnv,
      'with-user-details',
    ])
    const seeded = JSON.parse(readFileSync(configPath, 'utf8')) as GatewayConfig
    expect(seeded.revision).toBe(3)
    expect(seeded.operations.map(item => item.id)).toEqual([
      'registered-accounts',
      'share-code-usage',
      'share-code-unused',
      'registered-user-details',
    ])
    expect(seeded.grants[0]?.permissions).toContain('users.details.read')
    expect(seeded.grants[0]?.permissions).toContain('metrics.share-codes.available.read')
  })
})

describe('business gateway HTTP authorization', () => {
  it('serves all registered actions with invitation metrics scoped to the authenticated owner', async () => {
    const app = await start()
    try {
      const accounts = await fetch(`${app.origin}/metrics/registered-accounts`, { headers: headers('metrics.accounts.read') })
      const used = await fetch(`${app.origin}/metrics/share-code-usage`, { headers: headers('metrics.share-codes.read') })
      const unused = await fetch(`${app.origin}/metrics/share-code-unused`, { headers: headers('metrics.share-codes.available.read') })
      expect(await accounts.json()).toEqual({ count: 2, observedAt: '2026-09-01T00:00:00.000Z' })
      expect(await used.json()).toEqual({ count: 1, observedAt: '2026-09-01T00:00:00.000Z' })
      expect(await unused.json()).toEqual({ count: 1, observedAt: '2026-09-01T00:00:00.000Z' })
    } finally { await app.close() }
  })

  it('rejects authentication, permission, tenant, identity, method, query, and body violations', async () => {
    const app = await start()
    try {
      const path = `${app.origin}/metrics/registered-accounts`
      const responses = await Promise.all([
        fetch(path),
        fetch(path, { headers: { ...headers('metrics.accounts.read'), authorization: 'Bearer wrong' } }),
        fetch(path, { headers: headers('wrong.permission') }),
        fetch(path, { headers: { ...headers('metrics.accounts.read'), 'x-xiaowei-tenant-id': 'tenant-from-attacker' } }),
        fetch(path, { headers: headers('metrics.accounts.read', 'unknown-user') }),
        fetch(path, { headers: headers('metrics.accounts.read', 'u2') }),
        fetch(path, { method: 'POST', headers: headers('metrics.accounts.read'), body: '{}' }),
        fetch(`${path}?userId=u2`, { headers: headers('metrics.accounts.read') }),
      ])
      expect(responses.map(response => response.status)).toEqual([401, 401, 403, 403, 403, 403, 405, 400])
      const body = await rawBodyRequest(app.server, '/metrics/registered-accounts')
      expect(body.status).toBe(400)
      expect(JSON.parse(body.body)).toEqual({ error: 'request_failed' })
    } finally { await app.close() }
  })

  it('returns 503 when the service credential is unavailable', async () => {
    const app = await start(true, undefined, {})
    try {
      const response = await fetch(`${app.origin}/metrics/registered-accounts`, { headers: headers('metrics.accounts.read') })
      expect(response.status).toBe(503)
      expect(await response.json()).not.toHaveProperty('count')
    } finally { await app.close() }
  })
})

describe('registered-user detail pages', () => {
  it('returns deterministic bounded pages with only masked email and day-precision dates', async () => {
    const app = await start(true, undefined, { XIAOWEI_BUSINESS_API_TOKEN: 'service-secret' }, true)
    try {
      const first = await fetch(`${app.origin}/metrics/registered-user-details`, { headers: headers('users.details.read') })
      const second = await fetch(`${app.origin}/metrics/registered-user-details?page=2`, { headers: headers('users.details.read') })
      expect(first.status).toBe(200)
      expect(second.status).toBe(200)
      const firstPage = await first.json() as Record<string, unknown>
      const secondPage = await second.json() as Record<string, unknown>
      expect(firstPage).toMatchObject({ page: 1, pageSize: 10, hasMore: true, observedAt: '2026-09-01T00:00:00.000Z' })
      expect(secondPage).toMatchObject({ page: 2, pageSize: 10, hasMore: false, observedAt: '2026-09-01T00:00:00.000Z' })
      const firstItems = firstPage.items as Record<string, unknown>[]
      const secondItems = secondPage.items as Record<string, unknown>[]
      expect(firstItems).toHaveLength(10)
      expect(secondItems).toEqual([
        { maskedEmail: 's***@example.test', registeredDate: '2026-08-02' },
        { maskedEmail: 'f***@example.test', registeredDate: '2026-08-01' },
      ])
      for (const item of [...firstItems, ...secondItems]) {
        expect(Object.keys(item).sort()).toEqual(['maskedEmail', 'registeredDate'])
        expect(item.maskedEmail).toMatch(/^[a-z]\*\*\*@example\.test$/)
        expect(item.registeredDate).toMatch(/^2026-08-\d{2}$/)
        expect(item.registeredDate).not.toContain('T')
      }
      const serialized = JSON.stringify([firstPage, secondPage])
      for (const forbidden of ['first@example.test', 'second@example.test', 'user12@example.test', 'First User', 'Second User', 'hash-one', '"user_id"', '"display_name"', '"password_hash"']) {
        expect(serialized).not.toContain(forbidden)
      }
    } finally { await app.close() }
  })

  it('enforces an independent grant instead of inheriting aggregate metric access', async () => {
    const app = await start(true, undefined, { XIAOWEI_BUSINESS_API_TOKEN: 'service-secret' }, true)
    try {
      const withoutDetails: GatewayConfig = {
        ...app.config,
        revision: 2,
        grants: [{ subjectHash: subjectHash('u1'), permissions: ['metrics.accounts.read'] }],
      }
      writeFileSync(app.configPath, JSON.stringify(withoutDetails))
      expect(app.gateway.reload()).toBe(true)
      expect((await fetch(`${app.origin}/metrics/registered-accounts`, { headers: headers('metrics.accounts.read') })).status).toBe(200)
      expect((await fetch(`${app.origin}/metrics/registered-user-details`, { headers: headers('users.details.read') })).status).toBe(403)

      const onlyDetails: GatewayConfig = {
        ...app.config,
        revision: 3,
        grants: [{ subjectHash: subjectHash('u1'), permissions: ['users.details.read'] }],
      }
      writeFileSync(app.configPath, JSON.stringify(onlyDetails))
      expect(app.gateway.reload()).toBe(true)
      expect((await fetch(`${app.origin}/metrics/registered-accounts`, { headers: headers('metrics.accounts.read') })).status).toBe(403)
      expect((await fetch(`${app.origin}/metrics/registered-user-details`, { headers: headers('users.details.read') })).status).toBe(200)
    } finally { await app.close() }
  })

  it('rejects invalid, repeated, identity, tenant, body, and legacy-operation query input', async () => {
    const app = await start(true, undefined, { XIAOWEI_BUSINESS_API_TOKEN: 'service-secret' }, true)
    try {
      const path = `${app.origin}/metrics/registered-user-details`
      const badQueries = ['?page=0', '?page=-1', '?page=1.5', '?page=text', '?page=10001', '?page=1&page=2', '?limit=10', '?userId=u2', '?tenantId=t1']
      const responses = await Promise.all(badQueries.map(query => fetch(`${path}${query}`, { headers: headers('users.details.read') })))
      expect(responses.map(response => response.status)).toEqual(badQueries.map(() => 400))
      expect((await fetch(`${app.origin}/metrics/registered-accounts?page=1`, { headers: headers('metrics.accounts.read') })).status).toBe(400)
      const body = await rawBodyRequest(app.server, '/metrics/registered-user-details', 'users.details.read')
      expect(body.status).toBe(400)
      expect(JSON.parse(body.body)).toEqual({ error: 'request_failed' })
    } finally { await app.close() }
  })

  it('fails closed with a small response and detail-free audit when output exceeds 4096 bytes', async () => {
    const app = await start(true, undefined, { XIAOWEI_BUSINESS_API_TOKEN: 'service-secret' }, true)
    try {
      const writer = new DatabaseSync(app.dbPath)
      const update = writer.prepare('UPDATE users SET email = ? WHERE user_id = ?')
      for (let index = 3; index <= 12; index += 1) update.run(`x@${'界'.repeat(500)}.${index}.test`, `u${index}`)
      writer.close()
      const response = await fetch(`${app.origin}/metrics/registered-user-details`, { headers: headers('users.details.read') })
      expect(response.status).toBe(503)
      expect(await response.json()).toEqual({ error: 'response_too_large' })
      const audit = readFileSync(app.auditPath, 'utf8')
      expect(audit).toContain('denied:503')
      expect(audit).not.toContain('maskedEmail')
      expect(audit).not.toContain('registeredDate')
      expect(audit).not.toContain('界')
      expect(audit).not.toContain('"page"')
    } finally { await app.close() }
  })
})

describe('business gateway hot reload and audit', () => {
  it('adds an operation and grant to the same running instance', async () => {
    const app = await start(false)
    try {
      const path = `${app.origin}/metrics/share-code-unused`
      expect((await fetch(path, { headers: headers('metrics.share-codes.available.read') })).status).toBe(404)
      const next: GatewayConfig = {
        revision: 2,
        operations: [...app.config.operations, operation('unused', '/metrics/share-code-unused', 'unconsumed-invitation-count', 'metrics.share-codes.available.read')],
        grants: [{ subjectHash: subjectHash('u1'), permissions: ['metrics.accounts.read', 'metrics.share-codes.read', 'metrics.share-codes.available.read'] }],
      }
      const staged = `${app.configPath}.next`
      writeFileSync(staged, JSON.stringify(next))
      renameSync(staged, app.configPath)
      expect(app.gateway.reload()).toBe(true)
      const response = await fetch(path, { headers: headers('metrics.share-codes.available.read') })
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ count: 1 })
    } finally { await app.close() }
  })

  it('retains the last-good snapshot after an invalid atomic update', async () => {
    const app = await start()
    try {
      const staged = `${app.configPath}.next`
      writeFileSync(staged, JSON.stringify({ ...app.config, revision: 2, operations: [{ sql: 'SELECT * FROM users' }] }))
      renameSync(staged, app.configPath)
      expect(app.gateway.reload()).toBe(false)
      const response = await fetch(`${app.origin}/metrics/registered-accounts`, { headers: headers('metrics.accounts.read') })
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ count: 2 })
    } finally { await app.close() }
  })

  it('writes owner-only secret-free audit records with only a subject hash', async () => {
    const app = await start()
    try {
      await fetch(`${app.origin}/metrics/registered-accounts`, { headers: headers('metrics.accounts.read') })
      const audit = readFileSync(app.auditPath, 'utf8')
      expect(statSync(app.auditPath).mode & 0o777).toBe(0o600)
      expect(audit).toContain(subjectHash('u1'))
      expect(audit).not.toContain('"u1"')
      expect(audit).not.toContain('service-secret')
    } finally { await app.close() }
  })

  it('does not disclose a query result when the audit sink is unavailable', async () => {
    const f = fixture()
    const gateway = new BusinessGateway({
      configPath: f.configPath,
      databaseRoot: f.root,
      databasePath: f.dbPath,
      auditPath: f.root,
      env: { XIAOWEI_BUSINESS_API_TOKEN: 'service-secret' },
    })
    const server = createServer((req, res) => { gateway.handle(req, res) })
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('server address missing')
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/metrics/registered-accounts`, { headers: headers('metrics.accounts.read') })
      expect(response.status).toBe(503)
      expect(await response.json()).not.toHaveProperty('count')
    } finally {
      gateway.close()
      await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
    }
  })
})
