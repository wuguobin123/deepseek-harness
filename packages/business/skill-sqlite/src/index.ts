/** SQLite provider for immutable, account-scoped business Skill revisions. */

import { DatabaseSync } from 'node:sqlite'
import { mkdir, open } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import {
  BusinessSkillError, type BusinessSkillManifest, type SkillStore, type SkillVersion,
} from '@deepseek-ai/dsh-business-skill'
import { assertObjectJsonSchema, JsonSchemaError } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'

/** Current durable business Skill schema version. */
export const SCHEMA_VERSION = 1
export const name = 'business-skill-sqlite'
export const inject = ['businessSkill']

/** Durable business Skill storage configuration. */
export interface Config {
  /** SQLite database path below the deployment-owned runtime home. */
  path: string
}
export const Config: z<Config> = z.object({ path: z.string().required() })

const RESERVED = new Set([
  'userId', 'tenantId', 'principal', 'token', 'accessToken', 'authorization', 'roles', 'scopes',
])

function scanReservedFields(value: unknown, path = ''): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => { scanReservedFields(item, `${path}[${String(index)}]`) })
    return
  }
  if (value === null || typeof value !== 'object') return
  for (const [key, item] of Object.entries(value)) {
    if (RESERVED.has(key)) throw new BusinessSkillError('RESERVED_FIELD', `reserved field at ${path}/${key}`)
    scanReservedFields(item, `${path}/${key}`)
  }
}

/** Validate a manifest at the durable-input boundary.
 * @param ownerId - Trusted account owner derived by the Host.
 * @param value - Parsed manifest data.
 * @returns Validated, cloned manifest.
 */
export function validateManifest(ownerId: string, value: unknown): BusinessSkillManifest {
  if (ownerId.length === 0) throw new BusinessSkillError('OWNER_REQUIRED', 'ownerId is required')
  if (value === null || typeof value !== 'object') {
    throw new BusinessSkillError('INVALID_MANIFEST', 'manifest must be an object')
  }
  scanReservedFields(value)
  const manifest = value as Record<string, unknown>
  if (
    typeof manifest.name !== 'string' || !/^[a-z][a-z0-9-]{1,63}$/.test(manifest.name)
    || typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(manifest.version)
    || typeof manifest.description !== 'string' || manifest.description.trim().length === 0
  ) {
    throw new BusinessSkillError('INVALID_MANIFEST', 'name, version, description are invalid')
  }
  const connectionIds = manifest.connectionIds
  const credentialRefs = manifest.credentialRefs
  const operations = manifest.operations
  if (
    !Array.isArray(connectionIds) || !connectionIds.every(item => typeof item === 'string')
    || !Array.isArray(credentialRefs) || !credentialRefs.every(item => typeof item === 'string')
    || !Array.isArray(operations) || operations.length === 0
  ) {
    throw new BusinessSkillError('INVALID_MANIFEST', 'connectionIds, credentialRefs and operations are required')
  }
  for (const item of operations) {
    if (item === null || typeof item !== 'object') {
      throw new BusinessSkillError('INVALID_OPERATION', 'operation must be an object')
    }
    const operation = item as Record<string, unknown>
    if (
      typeof operation.id !== 'string' || operation.method !== 'GET'
      || typeof operation.path !== 'string' || !operation.path.startsWith('/')
      || typeof operation.permission !== 'string' || operation.permission.length === 0
      || typeof operation.connection !== 'string' || !connectionIds.includes(operation.connection)
      || operation.risk !== 'R1' || operation.input === null || typeof operation.input !== 'object'
      || operation.output === null || typeof operation.output !== 'object'
      || (operation.credentialRef !== undefined
        && (typeof operation.credentialRef !== 'string' || !credentialRefs.includes(operation.credentialRef)))
    ) {
      throw new BusinessSkillError('INVALID_OPERATION', `invalid operation ${String(operation.id)}`)
    }
    try {
      assertObjectJsonSchema(operation.input)
      assertObjectJsonSchema(operation.output)
    } catch (error) {
      if (error instanceof JsonSchemaError) {
        throw new BusinessSkillError(
          'INVALID_OPERATION',
          `invalid operation ${operation.id} schema: ${error.message}`,
        )
      }
      throw error
    }
  }
  return structuredClone(manifest) as unknown as BusinessSkillManifest
}

async function createFile(path: string): Promise<void> {
  try {
    const handle = await open(path, 'wx', 0o600)
    await handle.close()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

/** Open and migrate the configured database.
 * @param path - Database path or `:memory:` for tests.
 * @returns Open migrated database.
 */
export async function openBusinessSkillDatabase(path: string): Promise<DatabaseSync> {
  const actual = path === ':memory:' ? path : resolve(path)
  if (actual !== ':memory:') {
    await mkdir(dirname(actual), { recursive: true, mode: 0o700 })
    await createFile(actual)
  }
  const db = new DatabaseSync(actual)
  db.exec('PRAGMA foreign_keys=ON')
  const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
  if (version !== 0 && version !== SCHEMA_VERSION) {
    db.close()
    throw new Error(`business Skill schema version ${String(version)} unsupported`)
  }
  db.exec('CREATE TABLE IF NOT EXISTS skill_versions (owner_id TEXT NOT NULL, skill TEXT NOT NULL, revision INTEGER NOT NULL, manifest TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, PRIMARY KEY(owner_id,skill,revision)) STRICT')
  db.exec('CREATE INDEX IF NOT EXISTS skill_active ON skill_versions(owner_id,skill,active)')
  if (version === 0) db.exec(`PRAGMA user_version=${String(SCHEMA_VERSION)}`)
  return db
}

/** SQLite implementation with immutable revisions and an atomic active pointer. */
export class SqliteBusinessSkillStore implements SkillStore {
  constructor(private readonly db: DatabaseSync) {}

  validate(ownerId: string, manifest: unknown): BusinessSkillManifest {
    return validateManifest(ownerId, manifest)
  }

  publish(ownerId: string, manifest: BusinessSkillManifest, expectedRevision?: number): Promise<SkillVersion> {
    return deferred(() => {
      const validated = validateManifest(ownerId, manifest)
      this.db.exec('BEGIN IMMEDIATE')
      try {
        const current = this.latestRevision(ownerId, validated.name)
        assertExpectedRevision(current, expectedRevision)
        const revision = current + 1
        this.db.prepare('UPDATE skill_versions SET active=0 WHERE owner_id=? AND skill=?')
          .run(ownerId, validated.name)
        this.db.prepare('INSERT INTO skill_versions VALUES (?,?,?,?,?,?)')
          .run(ownerId, validated.name, revision, JSON.stringify(validated), 1, Date.now())
        this.db.exec('COMMIT')
        return { ownerId, revision, manifest: validated, active: true }
      } catch (error) {
        this.db.exec('ROLLBACK')
        throw error
      }
    })
  }

  list(ownerId: string): Promise<readonly SkillVersion[]> {
    return deferred(() => {
      const rows = this.db.prepare(
        'SELECT * FROM skill_versions WHERE owner_id=? ORDER BY skill, revision DESC',
      ).all(ownerId) as Array<Record<string, unknown>>
      return rows.map(row => this.decode(row))
    })
  }

  get(ownerId: string, skill: string, revision?: number): Promise<SkillVersion | null> {
    return deferred(() => {
      const row = revision === undefined
        ? this.db.prepare('SELECT * FROM skill_versions WHERE owner_id=? AND skill=? AND active=1')
          .get(ownerId, skill)
        : this.db.prepare('SELECT * FROM skill_versions WHERE owner_id=? AND skill=? AND revision=?')
          .get(ownerId, skill, revision)
      return row === undefined ? null : this.decode(row)
    })
  }

  resolve(ownerId: string, skill: string): Promise<SkillVersion | null> {
    return this.get(ownerId, skill)
  }

  disable(ownerId: string, skill: string, expectedRevision?: number): Promise<void> {
    return deferred(() => {
      this.db.exec('BEGIN IMMEDIATE')
      try {
        const current = this.activeRevision(ownerId, skill)
        assertExpectedRevision(current, expectedRevision)
        if (current === 0) throw new BusinessSkillError('SKILL_NOT_FOUND', 'active Skill not found')
        this.db.prepare('UPDATE skill_versions SET active=0 WHERE owner_id=? AND skill=?').run(ownerId, skill)
        this.db.exec('COMMIT')
      } catch (error) {
        this.db.exec('ROLLBACK')
        throw error
      }
    })
  }

  rollback(ownerId: string, skill: string, revision: number, expectedRevision?: number): Promise<SkillVersion> {
    return deferred(() => {
      this.db.exec('BEGIN IMMEDIATE')
      try {
        assertExpectedRevision(this.activeRevision(ownerId, skill), expectedRevision)
        const row = this.db.prepare(
          'SELECT * FROM skill_versions WHERE owner_id=? AND skill=? AND revision=?',
        ).get(ownerId, skill, revision)
        if (row === undefined) throw new BusinessSkillError('REVISION_NOT_FOUND', 'revision not found')
        this.db.prepare('UPDATE skill_versions SET active=(revision=?) WHERE owner_id=? AND skill=?')
          .run(revision, ownerId, skill)
        this.db.exec('COMMIT')
        return { ...this.decode(row), active: true }
      } catch (error) {
        this.db.exec('ROLLBACK')
        throw error
      }
    })
  }

  private latestRevision(ownerId: string, skill: string): number {
    const row = this.db.prepare(
      'SELECT COALESCE(MAX(revision),0) revision FROM skill_versions WHERE owner_id=? AND skill=?',
    ).get(ownerId, skill) as { revision: number }
    return row.revision
  }

  private activeRevision(ownerId: string, skill: string): number {
    const row = this.db.prepare(
      'SELECT revision FROM skill_versions WHERE owner_id=? AND skill=? AND active=1',
    ).get(ownerId, skill) as { revision: number } | undefined
    return row?.revision ?? 0
  }

  private decode(row: Record<string, unknown>): SkillVersion {
    return {
      ownerId: String(row.owner_id),
      revision: Number(row.revision),
      manifest: JSON.parse(String(row.manifest)) as BusinessSkillManifest,
      active: Boolean(row.active),
    }
  }
}

function assertExpectedRevision(actual: number, expected: number | undefined): void {
  if (expected !== undefined && expected !== actual) {
    throw new BusinessSkillError('REVISION_CONFLICT', 'active revision changed')
  }
}

function deferred<T>(operation: () => T): Promise<T> {
  return Promise.resolve().then(operation)
}

/** Mount the SQLite provider and close it with the Cordis fiber. */
export async function apply(ctx: Context, config: Config): Promise<() => void> {
  const db = await openBusinessSkillDatabase(config.path)
  const unregister = ctx.businessSkill.registerProvider(new SqliteBusinessSkillStore(db))
  return () => {
    unregister()
    db.close()
  }
}
