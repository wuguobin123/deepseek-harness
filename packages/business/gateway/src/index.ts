import { createHash, timingSafeEqual } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { appendFileSync, chmodSync, readFileSync, watchFile, unwatchFile } from 'node:fs'
import { resolve, relative, dirname } from 'node:path'
import { mkdirSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'

/** Registered provider implemented by this deployment artifact. */
export const PROVIDER = 'xiaowei-identity' as const
/** Closed set of reviewed read actions available to hot configuration. */
export const ACTIONS = ['registered-account-count', 'registered-user-page', 'consumed-invitation-count', 'unconsumed-invitation-count'] as const
/** One reviewed business read action. */
export type Action = typeof ACTIONS[number]
/** Validated route and authorization mapping for one operation. */
export interface Operation {
  readonly id: string
  readonly path: string
  readonly provider: typeof PROVIDER
  readonly action: Action
  readonly permission: string
  readonly ownerScoped: boolean
}
/** Subject-hashed permission grant loaded from deployment configuration. */
export interface Grant {
  readonly subjectHash: string
  readonly permissions: readonly string[]
}
/** Complete immutable hot-configuration snapshot. */
export interface GatewayConfig {
  readonly revision: number
  readonly operations: readonly Operation[]
  readonly grants: readonly Grant[]
}
/** Bounded metric response returned by registered actions. */
export interface MetricResult { readonly count: number; readonly observedAt: string }
/** Public, minimal registered-user detail page. */
export interface RegisteredUserPage {
  readonly items: readonly { maskedEmail: string; registeredDate: string }[]
  readonly page: number
  readonly pageSize: 10
  readonly hasMore: boolean
  readonly observedAt: string
}
/** Startup-owned locations, environment, and clock for one Gateway process. */
export interface GatewayOptions {
  readonly configPath: string
  readonly databaseRoot: string
  readonly databasePath: string
  readonly auditPath: string
  readonly env?: NodeJS.ProcessEnv
  readonly now?: () => Date
}

const FORBIDDEN = /sql|url|header|credential|userid|tenantid|token|role|scope/i
const ROOT_KEYS = new Set(['revision', 'operations', 'grants'])
const OPERATION_KEYS = new Set(['id', 'path', 'provider', 'action', 'permission', 'ownerScoped'])
const GRANT_KEYS = new Set(['subjectHash', 'permissions'])
const MAX_OUTPUT = 512
const MAX_DETAIL_OUTPUT = 4096
const MAX_AUDIT = 2048

function fail(message: string): never { throw new Error(`invalid gateway configuration: ${message}`) }
function walk(value: unknown): void {
  if (Array.isArray(value)) { for (const item of value) walk(item); return }
  if (value === null || typeof value !== 'object') return
  for (const [key, item] of Object.entries(value)) {
    if (key !== 'ownerScoped' && FORBIDDEN.test(key)) fail(`reserved field ${key}`)
    if (typeof item === 'string' && FORBIDDEN.test(item)) fail('reserved text')
    walk(item)
  }
}
function asString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) fail(`${name} must be a bounded string`)
  return value
}
function assertKeys(row: Record<string, unknown>, allowed: ReadonlySet<string>, name: string): void {
  for (const key of Object.keys(row)) if (!allowed.has(key)) fail(`${name} contains unsupported field ${key}`)
}

/**
 * Validate untrusted hot-configuration data against the closed action catalog.
 * @param value - Parsed JSON candidate.
 * @returns A complete configuration snapshot safe to activate.
 */
export function validateConfig(value: unknown): GatewayConfig {
  walk(value)
  if (value === null || typeof value !== 'object') fail('root must be an object')
  const row = value as Record<string, unknown>
  assertKeys(row, ROOT_KEYS, 'root')
  if ('serviceBearer' in row || 'bearer' in row || 'secret' in row) fail('credentials must be supplied by environment')
  if (typeof row.revision !== 'number' || !Number.isSafeInteger(row.revision) || row.revision < 1) fail('revision must be a positive integer')
  if (!Array.isArray(row.grants)) fail('grants must be an array')
  const grants = row.grants.map((item, index) => {
    if (item === null || typeof item !== 'object') fail(`grant ${index} must be an object`)
    const grant = item as Record<string, unknown>
    assertKeys(grant, GRANT_KEYS, `grant ${index}`)
    const subjectHash = asString(grant.subjectHash, 'subjectHash')
    if (!/^[a-f0-9]{64}$/.test(subjectHash)) fail('subjectHash must be sha256 hex')
    if (!Array.isArray(grant.permissions) || grant.permissions.some(x => typeof x !== 'string' || x.length === 0 || x.length > 200)) fail('grant permissions invalid')
    return { subjectHash, permissions: grant.permissions as string[] }
  })
  if (row.operations === null || typeof row.operations !== 'object') fail('operations must be an object or array')
  const operations: Operation[] = []
  const operationEntries = Array.isArray(row.operations)
    ? row.operations.map((raw, index) => [String(index), raw] as const)
    : Object.entries(row.operations as Record<string, unknown>)
  for (const [id, raw] of operationEntries) {
    if (raw === null || typeof raw !== 'object') fail(`operation ${id} invalid`)
    const op = raw as Record<string, unknown>
    assertKeys(op, OPERATION_KEYS, `operation ${id}`)
    if (op.provider !== PROVIDER) fail(`operation ${id} provider is not registered`)
    if (!ACTIONS.includes(op.action as Action)) fail(`operation ${id} action is not registered`)
    const operationId = asString(op.id, `operation ${id} id`)
    const permission = asString(op.permission, `operation ${id} permission`)
    const path = asString(op.path, `operation ${id} path`)
    if (!path.startsWith('/metrics/')) fail(`operation ${id} path must start with /metrics/`)
    if (typeof op.ownerScoped !== 'boolean') fail(`operation ${id} ownerScoped is required`)
    const expectedOwner = op.action !== 'registered-account-count' && op.action !== 'registered-user-page'
    if (op.ownerScoped !== expectedOwner) fail(`operation ${id} ownerScoped is unsafe`)
    if (operations.some(item => item.id === operationId || item.path === path)) fail(`duplicate operation ${id}`)
    operations.push({ id: operationId, path, provider: PROVIDER, action: op.action as Action, permission, ownerScoped: op.ownerScoped })
  }
  return { revision: row.revision, operations, grants }
}

/**
 * Derive the non-reversible subject key used by grants and audit records.
 * @param userId - Host-derived authenticated account id.
 * @returns Lowercase SHA-256 hexadecimal text.
 */
export const subjectHash = (userId: string): string => createHash('sha256').update(userId).digest('hex')
function maskEmail(email: string): string {
  const at = email.lastIndexOf('@')
  if (at <= 0 || at === email.length - 1) return '***'
  return `${email[0]}***${email.slice(at)}`
}
function safeEqual(a: string, b: string): boolean {
  const aa = createHash('sha256').update(a).digest(); const bb = createHash('sha256').update(b).digest()
  return timingSafeEqual(aa, bb)
}

/** Independent loopback business gateway. Each request captures one immutable config snapshot. */
export class BusinessGateway {
  private snapshot: GatewayConfig
  private readonly db: DatabaseSync
  private readonly now: () => Date
  private readonly watcher: () => void
  private closed = false
  constructor(private readonly options: GatewayOptions) {
    const databaseRoot = resolve(options.databaseRoot)
    const databasePath = resolve(options.databasePath)
    const databaseRelative = relative(databaseRoot, databasePath)
    if (databaseRelative.startsWith('..') || resolve(databaseRoot, databaseRelative) !== databasePath) {
      throw new Error('business gateway databasePath must be below databaseRoot')
    }
    this.snapshot = validateConfig(JSON.parse(readFileSync(options.configPath, 'utf8')))
    this.db = new DatabaseSync(options.databasePath, { readOnly: true })
    this.db.exec('PRAGMA query_only = ON')
    this.now = options.now ?? (() => new Date())
    this.watcher = () => { try { this.snapshot = validateConfig(JSON.parse(readFileSync(options.configPath, 'utf8'))) } catch { /* last-good remains active */ } }
    watchFile(options.configPath, { interval: 100 }, this.watcher)
  }
  /**
   * Replace config synchronously after full validation.
   * @returns Whether the candidate replaced the active snapshot.
   */
  reload(): boolean {
    try { this.snapshot = validateConfig(JSON.parse(readFileSync(this.options.configPath, 'utf8'))); return true } catch { return false }
  }
  /**
   * Handle one loopback HTTP request against a pinned snapshot.
   * @param req - Incoming request from the internal TLS proxy.
   * @param res - Response completed by this method.
   */
  handle(req: IncomingMessage, res: ServerResponse): void {
    const config = this.snapshot
    let status = 500; let result: MetricResult | RegisteredUserPage | undefined; const userId = req.headers['x-xiaowei-user-id']
    const user = typeof userId === 'string' ? userId : undefined
    const operationId = req.url?.split('?')[0]
    let auditAttempted = false
    try {
      if (req.method === 'GET' && req.url === '/health') { status = 200; this.write(res, { ok: true }, status); return }
      if (req.method !== 'GET') throw Object.assign(new Error('method not allowed'), { status: 405 })
      if (req.headers['content-length'] !== undefined || req.headers['transfer-encoding'] !== undefined) throw Object.assign(new Error('business input rejected'), { status: 400 })
      if (['x-tenant-id', 'tenant-id', 'x-xiaowei-tenant-id'].some(k => req.headers[k] !== undefined)) throw Object.assign(new Error('tenant header rejected'), { status: 403 })
      const auth = req.headers.authorization
      const bearer = this.options.env?.XIAOWEI_BUSINESS_API_TOKEN ?? process.env.XIAOWEI_BUSINESS_API_TOKEN
      if (bearer === undefined || bearer.length === 0) throw Object.assign(new Error('service credential unavailable'), { status: 503 })
      if (typeof auth !== 'string' || !auth.startsWith('Bearer ') || !safeEqual(auth.slice(7), bearer)) throw Object.assign(new Error('unauthorized'), { status: 401 })
      if (user === undefined || !/^[^\s]{1,256}$/.test(user)) throw Object.assign(new Error('user required'), { status: 403 })
      const op = config.operations.find(item => item.path === operationId)
      if (op === undefined) throw Object.assign(new Error('operation not found'), { status: 404 })
      let page = 1
      if (req.url?.includes('?')) {
        if (op.action !== 'registered-user-page') throw Object.assign(new Error('query rejected'), { status: 400 })
        const query = new URL(req.url, 'http://gateway.invalid').searchParams
        const keys = [...query.keys()]
        if (keys.length !== 1 || keys[0] !== 'page' || query.getAll('page').length !== 1) throw Object.assign(new Error('query rejected'), { status: 400 })
        const rawPage = query.get('page')
        if (rawPage === null || !/^\d+$/.test(rawPage)) throw Object.assign(new Error('page invalid'), { status: 400 })
        page = Number(rawPage)
        if (!Number.isSafeInteger(page) || page < 1 || page > 10000) throw Object.assign(new Error('page invalid'), { status: 400 })
      }
      const exists = this.db.prepare('SELECT 1 AS ok FROM users WHERE user_id = ?').get(user)
      if (exists === undefined) throw Object.assign(new Error('unknown user'), { status: 403 })
      const grant = config.grants.find(item => safeEqual(item.subjectHash, subjectHash(user)))
      if (req.headers['x-xiaowei-required-permission'] !== op.permission || grant === undefined || !grant.permissions.includes(op.permission)) throw Object.assign(new Error('forbidden'), { status: 403 })
      if (op.action === 'registered-user-page') {
        const rows = this.db.prepare('SELECT email, created_at FROM users ORDER BY created_at DESC, user_id DESC LIMIT 11 OFFSET ?').all((page - 1) * 10) as { email: string; created_at: number }[]
        const items = rows.slice(0, 10).map(row => ({
          maskedEmail: maskEmail(row.email),
          registeredDate: new Date(row.created_at).toISOString().slice(0, 10),
        }))
        result = { items, page, pageSize: 10, hasMore: rows.length > 10, observedAt: this.now().toISOString() }
        if (this.encodedSize(result) > MAX_DETAIL_OUTPUT) {
          auditAttempted = true; this.audit(user, operationId ?? '', 'denied:503'); this.write(res, { error: 'response_too_large' }, 503); return
        }
        auditAttempted = true; this.audit(user, operationId ?? '', 'ok'); this.write(res, result, 200, MAX_DETAIL_OUTPUT); return
      }
      const params = op.ownerScoped ? [user] : []
      const query = op.action === 'registered-account-count' ? 'SELECT COUNT(*) AS count FROM users' : op.action === 'consumed-invitation-count' ? `SELECT COUNT(*) AS count FROM invitations WHERE consumed_at IS NOT NULL${op.ownerScoped ? ' AND owner_id = ?' : ''}` : `SELECT COUNT(*) AS count FROM invitations WHERE consumed_at IS NULL${op.ownerScoped ? ' AND owner_id = ?' : ''}`
      const row = this.db.prepare(query).get(...params) as { count: number | bigint }
      const count = Number(row.count); if (!Number.isSafeInteger(count)) throw new Error('invalid count')
      result = { count, observedAt: this.now().toISOString() }
      if (this.encodedSize(result) > MAX_OUTPUT) {
        auditAttempted = true; this.audit(user, operationId ?? '', 'denied:503'); this.write(res, { error: 'response_too_large' }, 503); return
      }
      auditAttempted = true; this.audit(user, operationId ?? '', 'ok')
      this.write(res, result, 200, MAX_OUTPUT); return
    } catch (error) {
      status = (error as { status?: number }).status ?? 500
      if (!auditAttempted) { try { auditAttempted = true; this.audit(user, operationId ?? '', `denied:${status}`) } catch { status = 503 } }
      else if (status === 500) status = 503
      this.write(res, { error: status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : status === 405 ? 'method_not_allowed' : 'request_failed' }, status)
    }
  }
  private write(res: ServerResponse, value: unknown, status: number, limit = MAX_OUTPUT): void {
    const body = JSON.stringify(value)
    if (Buffer.byteLength(body, 'utf8') > limit) { res.statusCode = 503; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ error: 'response_too_large' })); return }
    res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(body)
  }
  private encodedSize(value: unknown): number { return Buffer.byteLength(JSON.stringify(value), 'utf8') }
  private audit(userId: string | undefined, operation: string, outcome: string): void {
    mkdirSync(dirname(this.options.auditPath), { recursive: true })
    const line = JSON.stringify({
      at: this.now().toISOString(), operation, outcome,
      subjectHash: userId === undefined ? undefined : subjectHash(userId),
    })
    if (line.length > MAX_AUDIT) throw new Error('audit entry too large'); appendFileSync(this.options.auditPath, `${line}\n`, { mode: 0o600 }); chmodSync(this.options.auditPath, 0o600)
  }
  /** Close database and stop hot reload. */
  close(): void { if (this.closed) return; this.closed = true; unwatchFile(this.options.configPath, this.watcher); this.db.close() }
}
