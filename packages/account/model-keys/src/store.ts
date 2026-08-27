/**
 * SQLite-backed model-key store. Owns one `DatabaseSync` connection over
 * `<dshHome>/user-model-keys.sqlite`; the abstract {@link UserModelKeyService}
 * operates against this typed surface.
 *
 * Layout: `user_model_keys(key_id PRIMARY KEY, user_id, key_value_encrypted,
 * label, created_at, last_used_at, revoked_at)`. The plaintext secret is
 * NEVER persisted — only the AES-256-GCM envelope.
 *
 * Why a dedicated file (not `identity.sqlite`):
 *   - The encrypted blob is the financial blast radius for this deployment —
 *     operators want backup + WAL-checkpoint cadence independent of identity.
 *   - Splitting lets `identity` remain account-only data while this table
 *     carries the credential side.
 *
 * `node:sqlite` (Node 22.5+) provides `DatabaseSync`; the engines range
 * `^22.19 || >=24` covers it. The constructor is synchronous, so the store
 * surface is too — Cordis boots are synchronous up to the first `await`.
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdir, open } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { UserId } from '@deepseek-ai/dsh-account-identity'
import type { KeyId, ModelKeyView } from './types.ts'

/** Current incompatible pre-release SQLite schema version. */
export const SCHEMA_VERSION = 4
/** SQLite application id for model-key databases (`DSHK`). */
export const APPLICATION_ID = 0x4453484B
const FILE_MODE = 0o600
const DIR_MODE = 0o700

/** A row from the `user_model_keys` table. */
export interface ModelKeyRow {
  readonly key_id: string
  readonly user_id: string
  readonly key_value_encrypted: Buffer
  readonly label: string
  readonly created_at: number
  readonly last_used_at: number | null
  readonly revoked_at: number | null
  readonly external_token_id: string | null
  readonly provider_route: string
  readonly base_url: string
  readonly model: string
  readonly input_price_micros: number
  readonly output_price_micros: number
  readonly revoke_error: string | null
}

const SCHEMA_DDL = `
  CREATE TABLE IF NOT EXISTS user_model_keys (
    key_id              TEXT PRIMARY KEY,
    user_id             TEXT NOT NULL,
    key_value_encrypted BLOB NOT NULL,
    label               TEXT NOT NULL,
    created_at          INTEGER NOT NULL,
    last_used_at        INTEGER,
    revoked_at          INTEGER,
    external_token_id  TEXT,
    provider_route     TEXT NOT NULL DEFAULT '',
    base_url            TEXT NOT NULL DEFAULT '',
    model               TEXT NOT NULL DEFAULT '',
    input_price_micros  INTEGER NOT NULL DEFAULT 0,
    output_price_micros INTEGER NOT NULL DEFAULT 0
    ,revoke_error TEXT
  ) STRICT;
  CREATE INDEX IF NOT EXISTS user_model_keys_user
    ON user_model_keys(user_id, created_at DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS user_model_keys_active_route
    ON user_model_keys(user_id, provider_route) WHERE revoked_at IS NULL;
  CREATE TABLE IF NOT EXISTS user_custom_models (
    custom_model_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    label TEXT NOT NULL,
    api TEXT NOT NULL,
    base_url TEXT NOT NULL,
    upstream_model TEXT NOT NULL,
    api_key_encrypted BLOB NOT NULL,
    created_at INTEGER NOT NULL,
    revoked_at INTEGER
  ) STRICT;
  CREATE INDEX IF NOT EXISTS user_custom_models_user
    ON user_custom_models(user_id, created_at DESC);
`

async function createDatabaseFile(path: string): Promise<void> {
  try {
    const handle = await open(path, 'wx', FILE_MODE)
    await handle.close()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

/** Open and validate a model-key database.
 * @param path SQLite path or `:memory:`.
 * @returns An initialized database handle.
 */
export async function openModelKeyDatabase(path: string): Promise<DatabaseSync> {
  const actual = path === ':memory:' ? path : resolve(path)
  if (actual !== ':memory:') {
    await mkdir(dirname(actual), { recursive: true, mode: DIR_MODE })
    await createDatabaseFile(actual)
  }
  const db = new DatabaseSync(actual)
  try {
    db.exec('PRAGMA foreign_keys = ON')
    db.exec('PRAGMA journal_mode = WAL')
    const header = db.prepare('PRAGMA application_id').get() as { application_id: number }
    const versionRow = db.prepare('PRAGMA user_version').get() as { user_version: number }
    const onDiskVersion = versionRow.user_version
    const onDiskApplication = header.application_id
    if (onDiskVersion === 0 && onDiskApplication !== 0) {
      throw new Error(
        `user-model-keys database at "${actual}" has application id ${onDiskApplication}, expected 0 or ${APPLICATION_ID}`,
      )
    }
    if (onDiskVersion !== 0 && onDiskVersion !== SCHEMA_VERSION) {
      throw new Error(
        `user-model-keys database at "${actual}" has schema version ${onDiskVersion}, incompatible with this build (${SCHEMA_VERSION})`,
      )
    }
    db.exec(SCHEMA_DDL)
    if (onDiskVersion === 0) {
      db.exec(`PRAGMA application_id = ${APPLICATION_ID}`)
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
    }
    return db
  } catch (error: unknown) {
    db.close()
    throw error
  }
}

/** Durable custom-model row. */
export interface CustomModelRow {
  readonly custom_model_id: string
  readonly user_id: string
  readonly label: string
  readonly api: 'openai-completions' | 'openai-responses'
  readonly base_url: string
  readonly upstream_model: string
  readonly api_key_encrypted: Buffer
  readonly created_at: number
  readonly revoked_at: number | null
}

/** Metadata view of a custom model. */
export interface CustomModelView {
  readonly customModelId: string
  readonly userId: UserId
  readonly label: string
  readonly api: 'openai-completions' | 'openai-responses'
  readonly baseURL: string
  readonly upstreamModel: string
  readonly created: number
  readonly revoked: number | null
}

/** Decode one custom-model row at the durable SQLite boundary.
 * @param value Raw SQLite row.
 * @returns The validated custom-model row.
 */
export function decodeCustomModelRow(value: unknown): CustomModelRow {
  if (typeof value !== 'object' || value === null) throw new TypeError('user-model-keys: stored custom model row must be an object')
  const row = value as Record<string, unknown>
  if (typeof row['custom_model_id'] !== 'string' || !/^cm_[a-f0-9]{16}$/.test(row['custom_model_id'])) throw new TypeError('user-model-keys: stored custom_model_id is invalid')
  if (typeof row['user_id'] !== 'string' || row['user_id'].length === 0) throw new TypeError('user-model-keys: stored custom user_id is invalid')
  if (typeof row['label'] !== 'string' || row['label'].length === 0 || row['label'].length > 64) throw new TypeError('user-model-keys: stored custom label is invalid')
  if (row['api'] !== 'openai-completions' && row['api'] !== 'openai-responses') throw new TypeError('user-model-keys: stored custom api is invalid')
  if (typeof row['base_url'] !== 'string' || row['base_url'].length === 0 || row['base_url'].length > 2048) throw new TypeError('user-model-keys: stored custom base_url is invalid')
  if (typeof row['upstream_model'] !== 'string' || row['upstream_model'].length === 0 || row['upstream_model'].length > 128) throw new TypeError('user-model-keys: stored custom upstream_model is invalid')
  const revoked = row['revoked_at']
  if (revoked !== null && (typeof revoked !== 'number' || !Number.isSafeInteger(revoked))) throw new TypeError('user-model-keys: stored custom revoked_at is invalid')
  return {
    custom_model_id: row['custom_model_id'], user_id: row['user_id'], label: row['label'], api: row['api'],
    base_url: row['base_url'], upstream_model: row['upstream_model'], api_key_encrypted: toBuffer(row['api_key_encrypted'], 'api_key_encrypted'),
    created_at: requireInt(row['created_at'], 'custom created_at'), revoked_at: revoked,
  }
}

function requireInt(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new TypeError(`user-model-keys: stored ${name} must be a safe integer`)
  }
  return value
}

function toBuffer(value: unknown, name: string): Buffer {
  if (Buffer.isBuffer(value)) return value
  if (value instanceof Uint8Array) return Buffer.from(value)
  throw new TypeError(`user-model-keys: stored ${name} must be a Buffer or Uint8Array`)
}

/** Decode a SQLite result at the durable data boundary.
 * @param value Raw SQLite row.
 * @returns A validated model-key row.
 */
export function decodeModelKeyRow(value: unknown): ModelKeyRow {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('user-model-keys: stored row must be an object')
  }
  const row = value as Record<string, unknown>
  if (typeof row['key_id'] !== 'string') throw new TypeError('user-model-keys: stored key_id must be a string')
  if (typeof row['user_id'] !== 'string') throw new TypeError('user-model-keys: stored user_id must be a string')
  if (typeof row['label'] !== 'string') throw new TypeError('user-model-keys: stored label must be a string')
  if (row['external_token_id'] !== null && typeof row['external_token_id'] !== 'string') throw new TypeError('user-model-keys: stored external_token_id must be a string or null')
  const lastUsedAt = row['last_used_at']
  if (lastUsedAt !== null && (typeof lastUsedAt !== 'number' || !Number.isSafeInteger(lastUsedAt))) {
    throw new TypeError('user-model-keys: stored last_used_at must be a safe integer or null')
  }
  const revokedAt = row['revoked_at']
  if (revokedAt !== null && (typeof revokedAt !== 'number' || !Number.isSafeInteger(revokedAt))) {
    throw new TypeError('user-model-keys: stored revoked_at must be a safe integer or null')
  }
  return {
    key_id: row['key_id'],
    user_id: row['user_id'],
    key_value_encrypted: toBuffer(row['key_value_encrypted'], 'key_value_encrypted'),
    label: row['label'],
    created_at: requireInt(row['created_at'], 'created_at'),
    last_used_at: lastUsedAt,
    revoked_at: revokedAt,
    external_token_id: row['external_token_id'],
    provider_route: row['provider_route'] as string,
    base_url: row['base_url'] as string,
    model: row['model'] as string,
    input_price_micros: requireInt(row['input_price_micros'], 'input_price_micros'),
    output_price_micros: requireInt(row['output_price_micros'], 'output_price_micros'),
    revoke_error: row['revoke_error'] as string | null,
  }
}

/**
 * SQLite-backed model-key store. Returned by {@link openModelKeyDatabase}
 * wrapped in a small lifecycle object so the {@link UserModelKeyService}
 * implementation can own it as a private field.
 */
export class ModelKeyStore {
  private readonly db: DatabaseSync
  private closed = false

  constructor(db: DatabaseSync) {
    this.db = db
  }

  /** Insert one encrypted credential row.
   * @param input Complete credential fields.
   */
  insertRow(input: {
    keyId: KeyId
    userId: UserId
    encrypted: Buffer
    label: string
    createdAt: number
    externalTokenId: string
    providerRoute: string
    baseUrl: string
    model: string
    inputPriceMicros: number
    outputPriceMicros: number
  }): void {
    this.db.prepare(
      'INSERT INTO user_model_keys (key_id, user_id, key_value_encrypted, label, created_at, last_used_at, revoked_at, external_token_id, provider_route, base_url, model, input_price_micros, output_price_micros) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?)',
    ).run(
      input.keyId, input.userId, input.encrypted, input.label, input.createdAt,
      input.externalTokenId, input.providerRoute, input.baseUrl, input.model,
      input.inputPriceMicros, input.outputPriceMicros,
    )
  }

  /** Find one credential by opaque id.
   * @param keyId Credential id.
   * @returns The row when present.
   */
  findByKeyId(keyId: KeyId): ModelKeyRow | undefined {
    const row = this.db.prepare('SELECT * FROM user_model_keys WHERE key_id = ?').get(keyId)
    return row === undefined ? undefined : decodeModelKeyRow(row)
  }

  /** List all credentials for one account.
   * @param userId Account id.
   * @returns Newest-first rows.
   */
  listByUserId(userId: UserId): ModelKeyRow[] {
    const rows = this.db.prepare(
      'SELECT * FROM user_model_keys WHERE user_id = ? ORDER BY created_at DESC',
    ).all(userId) as unknown[]
    return rows.map(decodeModelKeyRow)
  }

  /** Mark an active row revoked.
   * @param keyId Credential id.
   * @param revokedAt Revocation time in Unix milliseconds.
   * @returns Number of changed rows.
   */
  markRevoked(keyId: KeyId, revokedAt: number): number {
    const result = this.db.prepare(
      'UPDATE user_model_keys SET revoked_at = ? WHERE key_id = ? AND revoked_at IS NULL',
    ).run(revokedAt, keyId)
    return Number(result.changes)
  }

  /** Find the active credential for one account route.
   * @param userId Account id.
   * @param route Provider route.
   * @returns The active row when present.
   */
  findActiveByRoute(userId: UserId, route: string): ModelKeyRow | undefined {
    const row = this.db.prepare('SELECT * FROM user_model_keys WHERE user_id = ? AND provider_route = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1').get(userId, route)
    return row === undefined ? undefined : decodeModelKeyRow(row)
  }

  /** Record successful internal credential resolution.
   * @param keyId Credential id.
   * @param at Resolution time in Unix milliseconds.
   */
  touchLastUsed(keyId: KeyId, at: number): void {
    this.db.prepare('UPDATE user_model_keys SET last_used_at = ? WHERE key_id = ? AND revoked_at IS NULL').run(at, keyId)
  }

  /** Persist or clear an upstream revocation failure.
   * @param keyId Credential id.
   * @param error Failure text, or null after success.
   */
  setRevokeError(keyId: KeyId, error: string | null): void {
    this.db.prepare('UPDATE user_model_keys SET revoke_error = ? WHERE key_id = ?').run(error, keyId)
  }

  /** Close the database handle. */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.db.close()
  }

  /** Report whether the handle is closed.
   * @returns True after close.
   */
  isClosed(): boolean {
    return this.closed
  }

  /** Insert an encrypted custom model row.
   * @param input Complete custom-model fields to persist.
   */
  insertCustomRow(input: { customModelId: string; userId: UserId; label: string; api: CustomModelRow['api']; baseURL: string; upstreamModel: string; encrypted: Buffer; created: number }): void {
    this.db.prepare('INSERT INTO user_custom_models (custom_model_id, user_id, label, api, base_url, upstream_model, api_key_encrypted, created_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)').run(input.customModelId, input.userId, input.label, input.api, input.baseURL, input.upstreamModel, input.encrypted, input.created)
  }

  /** List custom models owned by a user.
   * @param userId Account identifier.
   * @returns Newest-first custom-model rows.
   */
  listCustomByUserId(userId: UserId): CustomModelRow[] {
    return (this.db.prepare('SELECT * FROM user_custom_models WHERE user_id = ? ORDER BY created_at DESC').all(userId) as unknown[]).map(decodeCustomModelRow)
  }

  /** Find one custom model, optionally requiring its owner.
   * @param customModelId Custom-model identifier.
   * @param userId Optional account owner constraint.
   * @returns The row when present.
   */
  findCustom(customModelId: string, userId?: UserId): CustomModelRow | undefined {
    const row = userId === undefined
      ? this.db.prepare('SELECT * FROM user_custom_models WHERE custom_model_id = ?').get(customModelId)
      : this.db.prepare('SELECT * FROM user_custom_models WHERE custom_model_id = ? AND user_id = ?').get(customModelId, userId)
    return row === undefined ? undefined : decodeCustomModelRow(row)
  }

  /** Revoke one owned custom model.
   * @param customModelId Custom-model identifier.
   * @param userId Account owner identifier.
   * @param at Revocation time in Unix milliseconds.
   * @returns Whether a previously active row was revoked.
   */
  revokeCustom(customModelId: string, userId: UserId, at: number): boolean {
    const result = this.db.prepare('UPDATE user_custom_models SET revoked_at = ? WHERE custom_model_id = ? AND user_id = ? AND revoked_at IS NULL').run(at, customModelId, userId)
    return Number(result.changes) > 0
  }
}

/** Build the wire-visible view for a stored row.
 * @param row Durable encrypted row.
 * @returns Metadata without the bearer token.
 */
export function toModelKeyView(row: ModelKeyRow): ModelKeyView {
  return {
    keyId: row.key_id as KeyId,
    userId: row.user_id as UserId,
    label: row.label,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    providerRoute: row.provider_route,
    apiBaseUrl: row.base_url,
    model: row.model,
    inputPriceMicrosPerToken: row.input_price_micros,
    outputPriceMicrosPerToken: row.output_price_micros,
  }
}
