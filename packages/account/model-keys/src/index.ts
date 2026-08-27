/**
 * Service Definition + default SQLite-backed provider for the local xiaowei
 * user-model-key seam.
 *
 * The seam owns two brand types (`KeyId`, `KeyValue`), four public methods
 * (`provision` / `list` / `revoke` / `resolveActive`), and the lifecycle of AES-256-GCM-encrypted
 * API keys over `<dshHome>/user-model-keys.sqlite`. Wire methods in
 * `packages/host/apiproxy/src/api/model-keys.ts` consume the same provider via
 * `ctx.userModelKeys`.
 *
 * Upstream tokens are service-side secrets. They are encrypted at rest and
 * never returned by account RPCs; only `resolveActive()` exposes one to the
 * in-process model consumer.
 *
 * **Trigger chain**: `LocalIdentityProvider.signup()` ends with the calling
 * plugin (`packages/host/apiproxy/src/api/account.ts`) invoking
 * `ctx.userModelKeys.provision({ userId })`. A provisioning failure is logged
 * but does NOT roll back the user — they can retry provisioning later.
 *
 * Single-package pre-release stance: the abstract `UserModelKeyService` and the
 * sole implementation `LocalUserModelKeyProvider` live here together. A hosted
 * "model-accounts-as-a-service" provider would split this seam into its own
 * package; for now, the SQLite shape is the only shape the harness needs.
 *
 * @module @deepseek-ai/dsh-account-model-keys
 */
import { Context, Service } from '@deepseek-ai/cordis'
import { createHash } from 'node:crypto'
import z from '@deepseek-ai/schemastery'
import type { UserId } from '@deepseek-ai/dsh-account-identity'
import { ModelKeyStore, openModelKeyDatabase, toModelKeyView } from './store.ts'
import { decodeMasterKey, decryptValue, encryptValue, mintKeyId } from './crypto.ts'
import { DEFAULT_MAX_CUSTOM_MODELS, MAX_LABEL_LENGTH, ModelKeyError, assertCustomModelInput, assertLabel } from './errors.ts'
import type { ActiveModelCredential, CustomModelId, CustomModelView, KeyId, KeyValue, ModelKeyView, ProvisionedKey, ResolvedCustomModel } from './types.ts'

/** Stable provider route used for account-owned custom models. */
export const CUSTOM_MODEL_PROVIDER_ROUTE = 'xiaowei-custom'

/** Plugin configuration. */
export interface Config {
  /** Path to the SQLite database file (`:memory:` for tests). */
  path: string
  /**
   * 32 raw bytes, urlsafe-base64. The deployment-wide master key used to
   * seal the on-disk secret. Presence is validated at plugin load; base64
   * decoding and exact byte-length validation occur on first use.
   */
  masterKey: string
  /** Default label attached to new keys (overridable per `provision()`). */
  defaultLabel?: string
  /** Maximum active custom models per account. */
  maxCustomModels?: number
  /** New-API management and model data-plane settings. Prices are CNY micros/token. */
  newApi?: {
    /** New-API administrative endpoint. */
    adminUrl: string
    /** New-API token issuance endpoint. */
    apiBaseUrl: string
    /** Administrative username. */
    username: string
    /** Administrative password. */
    password: string
    /** Display name assigned to issued tokens. */
    displayName?: string
    /** New-API user group for issued tokens. */
    userGroup: string
    /** Token quota in provider units. */
    tokenQuota: number
    /** Whether issued tokens have unlimited quota. */
    tokenUnlimitedQuota: boolean
    /** Lifetime of issued tokens in days. */
    tokenExpiresDays: number
    /** Whether model limits are enabled for issued tokens. */
    modelLimitsEnabled: boolean
    /** Provider route stored on provisioned credentials. */
    route: string
    /** Upstream model assigned to provisioned credentials. */
    model: string
    /** Input price in CNY micros per token. */
    inputPriceMicrosPerToken: number
    /** Output price in CNY micros per token. */
    outputPriceMicrosPerToken: number
    /** HTTP request timeout in milliseconds. */
    timeoutMs: number
    /** Number of failed HTTP request retries. */
    retries: number
  }
}

const newApiSchema = z.object({
  adminUrl: z.string().min(1).required(),
  apiBaseUrl: z.string().min(1).required(),
  username: z.string().min(1).required(),
  password: z.string().min(1).required(),
  displayName: z.string().max(64),
  userGroup: z.string().min(1).required(),
  tokenQuota: z.number().step(1).min(0),
  tokenUnlimitedQuota: z.boolean().default(true),
  tokenExpiresDays: z.number().step(1).min(0),
  modelLimitsEnabled: z.boolean().default(true),
  route: z.string().min(1).required(),
  model: z.string().min(1).required(),
  inputPriceMicrosPerToken: z.number().step(1).min(0),
  outputPriceMicrosPerToken: z.number().step(1).min(0),
  timeoutMs: z.number().step(1).min(1),
  retries: z.number().step(1).min(0),
})

export const Config: z<Config> = z.object({
  path: z.string().min(1).required(),
  masterKey: z.string().min(1).required(),
  defaultLabel: z.string().max(MAX_LABEL_LENGTH).default('xiaowei'),
  maxCustomModels: z.number().step(1).min(1).max(1000).default(DEFAULT_MAX_CUSTOM_MODELS),
  newApi: z.union([newApiSchema, z.const(undefined)]),
}) as unknown as z<Config>

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The local user-model-key provider. */
    userModelKeys: UserModelKeyService
  }
}

/**
 * The Service Definition. Every implementation owns one
 * `user_model_keys` table; hosted / Stripe-backed providers would extend this
 * contract without changing the wire shape.
 */
export abstract class UserModelKeyService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'userModelKeys')
  }

  /**
   * Ensure one active upstream credential for this user and provider route.
   * @param input.userId The user the key is issued for.
   * @param input.label Optional human label (default from `Config.defaultLabel`).
   * @returns Metadata for the active credential. The bearer token remains internal.
   * @throws ModelKeyError when configured key material or upstream issuance fails.
   * @throws ModelKeyError when the upstream issuer cannot ensure a credential.
   */
  abstract provision(input: { userId: UserId; label?: string }): Promise<ProvisionedKey>

  /**
   * List metadata for every key owned by `userId`, newest first.
   * @param input.userId The user whose key metadata is queried.
   * @returns Newest-first key metadata rows (never the plaintext `keyValue`).
   */
  abstract list(input: { userId: UserId }): Promise<ModelKeyView[]>

  /**
   * Mark `keyId` as revoked. Idempotent — revoking an unknown or already-
   * revoked key resolves with `revoked: false` rather than throwing.
   * @param input.keyId The key row id to revoke.
   * @returns `{ revoked: true }` if this call closed a live row; `false`
   *   if the row was unknown or already revoked.
   */
  abstract revoke(input: { keyId: KeyId }): Promise<{ revoked: boolean }>

  /**
   * Resolve the encrypted active upstream token for model execution.
   * @param input.userId User whose credential is needed.
   * @param input.route Optional provider route filter.
   * @returns Internal credential metadata and token, or undefined when absent.
   */
  abstract resolveActive(input: { userId: UserId; route?: string }): Promise<ActiveModelCredential | undefined>

  /**
   * Create one account-owned custom model with an encrypted API key.
   * @param input - Owner, public endpoint metadata, upstream model, and write-only key.
   * @returns Public metadata without the API key.
   */
  abstract createCustom(input: { userId: UserId; label: string; api: 'openai-completions' | 'openai-responses'; baseURL: string; upstreamModel: string; apiKey: string }): Promise<CustomModelView>
  /**
   * List custom models for one account.
   * @param input - Account whose records are listed.
   * @returns Newest-first metadata without API keys.
   */
  abstract listCustom(input: { userId: UserId }): Promise<CustomModelView[]>
  /**
   * Revoke one custom model only when owned by the account.
   * @param input - Account and opaque custom-model id.
   * @returns Whether this call revoked an active owned row.
   */
  abstract removeCustom(input: { userId: UserId; customModelId: CustomModelId }): Promise<{ removed: boolean }>
  /**
   * Resolve one custom model only when owned by the account.
   * @param input - Account and opaque custom-model id.
   * @returns Decrypted internal record, or undefined when unavailable.
   */
  abstract resolveCustom(input: { userId: UserId; customModelId: CustomModelId }): Promise<ResolvedCustomModel | undefined>
}

/**
 * SQLite-backed local provider. Singleton per Cordis context.
 *
 * Lifecycle:
 *   - Configuration rejects missing deployment values at load; the master key
 *     is decoded on first use.
 *   - `[Service.init]` opens the SQLite handle and applies the schema.
 *   - Disposal closes the underlying handle.
 */
export class LocalUserModelKeyProvider extends UserModelKeyService {
  static Config = Config

  private storeReady: Promise<ModelKeyStore> | undefined
  private masterKey: Buffer | undefined
  private closed = false
  private readonly ensureLocks = new Map<string, Promise<ProvisionedKey>>()

  constructor(ctx: Context, public config: Config) {
    super(ctx)
  }

  async *[Service.init](): AsyncGenerator<() => Promise<void> | void, void, void> {
    const store = await this.openStore()
    yield () => {
      this.closed = true
      store.close()
    }
  }

  private openStore(): Promise<ModelKeyStore> {
    if (this.storeReady !== undefined) return this.storeReady
    this.storeReady = (async () => {
      const db = await openModelKeyDatabase(this.config.path)
      return new ModelKeyStore(db)
    })()
    this.storeReady.catch(() => undefined)
    return this.storeReady
  }

  private requireMasterKey(): Buffer {
    if (this.masterKey === undefined) {
      this.masterKey = decodeMasterKey(this.config.masterKey)
    }
    return this.masterKey
  }

  override async provision(input: { userId: UserId; label?: string }): Promise<ProvisionedKey> {
    this.assertUserId(input.userId)
    const label = input.label ?? this.config.defaultLabel ?? 'xiaowei'
    assertLabel(label)
    const upstream = this.config.newApi
    if (upstream === undefined) throw new ModelKeyError('MODEL_KEYS_UNAVAILABLE', 'new-api token issuer is not configured')
    const lockKey = `${input.userId}\0${upstream.route}`
    const prior = this.ensureLocks.get(lockKey)
    if (prior !== undefined) return prior
    const operation = this.provisionLocked(input, label, upstream)
    this.ensureLocks.set(lockKey, operation)
    try { return await operation } finally { if (this.ensureLocks.get(lockKey) === operation) this.ensureLocks.delete(lockKey) }
  }

  private async provisionLocked(input: { userId: UserId; label?: string }, label: string, upstream: NonNullable<Config['newApi']>): Promise<ProvisionedKey> {
    const store = await this.openStore()
    this.assertOpen(store)
    const existing = store.findActiveByRoute(input.userId, upstream.route)
    if (existing !== undefined) return toModelKeyView(existing)
    const masterKey = this.requireMasterKey()
    const keyId = mintKeyId() as KeyId
    const issued = await issueNewApiToken(upstream, input.userId)
    const keyValue = issued.token as KeyValue
    const createdAt = Date.now()
    const encrypted = encryptValue(masterKey, keyValue)
    store.insertRow({
      keyId,
      userId: input.userId,
      encrypted,
      label,
      createdAt,
      externalTokenId: issued.externalTokenId,
      providerRoute: upstream.route, baseUrl: upstream.apiBaseUrl, model: upstream.model,
      inputPriceMicros: upstream.inputPriceMicrosPerToken, outputPriceMicros: upstream.outputPriceMicrosPerToken,
    })
    this.ctx.logger.info('user-model-keys: provisioned keyId=%s userId=%s label=%s', keyId, input.userId, label)
    return {
      keyId,
      userId: input.userId,
      label,
      createdAt,
      providerRoute: upstream.route, model: upstream.model,
    }
  }

  override async list(input: { userId: UserId }): Promise<ModelKeyView[]> {
    this.assertUserId(input.userId)
    const store = await this.openStore()
    this.assertOpen(store)
    return store.listByUserId(input.userId).map(toModelKeyView)
  }

  override async revoke(input: { keyId: KeyId }): Promise<{ revoked: boolean }> {
    if (typeof input.keyId !== 'string' || input.keyId.length === 0) {
      throw new ModelKeyError('BAD_REQUEST', 'keyId must be a non-empty string')
    }
    const store = await this.openStore()
    this.assertOpen(store)
    const row = store.findByKeyId(input.keyId)
    if (row === undefined) return { revoked: false }
    if (row.revoked_at !== null && row.revoke_error === null) return { revoked: false }
    const changed = row.revoked_at === null ? store.markRevoked(input.keyId, Date.now()) : 0
    try {
      if (this.config.newApi !== undefined && row.external_token_id !== null) {
        await revokeNewApiToken(this.config.newApi, row.external_token_id)
      }
      store.setRevokeError(input.keyId, null)
      return { revoked: changed > 0 }
    } catch (error) {
      store.setRevokeError(input.keyId, error instanceof Error ? error.message : String(error))
      throw error
    }
  }

  override async resolveActive(input: { userId: UserId; route?: string }): Promise<ActiveModelCredential | undefined> {
    this.assertUserId(input.userId)
    const store = await this.openStore()
    this.assertOpen(store)
    const row = store.listByUserId(input.userId).find(value =>
      value.revoked_at === null && (input.route === undefined || value.provider_route === input.route))
    if (row === undefined) return undefined
    store.touchLastUsed(row.key_id as KeyId, Date.now())
    return {
      keyId: row.key_id as KeyId,
      token: decryptValue(this.requireMasterKey(), row.key_value_encrypted) as KeyValue,
      apiBaseUrl: row.base_url,
      model: row.model,
      route: row.provider_route,
      inputPriceMicrosPerToken: row.input_price_micros,
      outputPriceMicrosPerToken: row.output_price_micros,
    }
  }

  private assertUserId(value: unknown): asserts value is UserId {
    if (typeof value !== 'string' || value.length === 0) {
      throw new ModelKeyError('BAD_REQUEST', 'userId must be a non-empty string')
    }
  }

  private assertOpen(store: ModelKeyStore): void {
    if (this.closed || store.isClosed()) {
      throw new ModelKeyError('MODEL_KEYS_UNAVAILABLE', 'user-model-keys provider has been disposed')
    }
  }

  override async createCustom(input: {
    userId: UserId
    label: string
    api: 'openai-completions' | 'openai-responses'
    baseURL: string
    upstreamModel: string
    apiKey: string
  }): Promise<CustomModelView> {
    this.assertUserId(input.userId)
    assertCustomModelInput(input)
    const store = await this.openStore()
    this.assertOpen(store)
    const active = store.listCustomByUserId(input.userId).filter(row => row.revoked_at === null)
    if (active.length >= (this.config.maxCustomModels ?? DEFAULT_MAX_CUSTOM_MODELS)) {
      throw new ModelKeyError('BAD_REQUEST', 'custom model limit reached')
    }
    const customModelId = `cm_${mintKeyId().slice(3)}` as CustomModelId
    const created = Date.now()
    store.insertCustomRow({
      customModelId,
      userId: input.userId,
      label: input.label,
      api: input.api,
      baseURL: input.baseURL,
      upstreamModel: input.upstreamModel,
      encrypted: encryptValue(this.requireMasterKey(), input.apiKey),
      created,
    })
    return {
      customModelId,
      userId: input.userId,
      label: input.label,
      api: input.api,
      baseURL: input.baseURL,
      upstreamModel: input.upstreamModel,
      created,
      revoked: null,
    }
  }

  override async listCustom(input: { userId: UserId }): Promise<CustomModelView[]> {
    this.assertUserId(input.userId)
    const store = await this.openStore()
    this.assertOpen(store)
    return store.listCustomByUserId(input.userId).map(row => ({
      customModelId: row.custom_model_id as CustomModelId,
      userId: row.user_id as UserId,
      label: row.label,
      api: row.api,
      baseURL: row.base_url,
      upstreamModel: row.upstream_model,
      created: row.created_at,
      revoked: row.revoked_at,
    }))
  }

  override async removeCustom(input: { userId: UserId; customModelId: CustomModelId }): Promise<{ removed: boolean }> {
    this.assertUserId(input.userId)
    const store = await this.openStore()
    this.assertOpen(store)
    return { removed: store.revokeCustom(input.customModelId, input.userId, Date.now()) }
  }

  override async resolveCustom(input: { userId: UserId; customModelId: CustomModelId }): Promise<ResolvedCustomModel | undefined> {
    this.assertUserId(input.userId)
    const store = await this.openStore()
    this.assertOpen(store)
    const row = store.findCustom(input.customModelId, input.userId)
    if (row === undefined || row.revoked_at !== null) return undefined
    return {
      customModelId: row.custom_model_id as CustomModelId,
      userId: row.user_id as UserId,
      label: row.label,
      api: row.api,
      baseURL: row.base_url,
      upstreamModel: row.upstream_model,
      created: row.created_at,
      revoked: row.revoked_at,
      apiKey: decryptValue(this.requireMasterKey(), row.api_key_encrypted) as KeyValue,
    }
  }
}

export default LocalUserModelKeyProvider

export type { ActiveModelCredential, CustomModelId, CustomModelView, KeyId, KeyValue, ModelKeyView, ProvisionedKey, ResolvedCustomModel } from './types.ts'
export { ModelKeyError } from './errors.ts'
export { SCHEMA_VERSION as USER_MODEL_KEYS_SQLITE_SCHEMA_VERSION, APPLICATION_ID as USER_MODEL_KEYS_SQLITE_APPLICATION_ID } from './store.ts'
export { decodeMasterKey } from './crypto.ts'

async function issueNewApiToken(config: NonNullable<Config['newApi']>, userId: string): Promise<{ token: string; externalTokenId: string }> {
  const admin = config.adminUrl.replace(/\/$/, '')
  const headers = await loginAdmin(config)
  const name = `${config.displayName ?? 'dsh'}-${createHash('sha256').update(userId).digest('hex').slice(0, 16)}`
  const listed = await fetchWithRetry(`${admin}/token/?p=0&page_size=50&name=${encodeURIComponent(name)}`, { method: 'GET', headers }, config)
  const newestNamed = (items: ReturnType<typeof parseTokenItems>) => items
    .filter(item => item.name === name)
    .sort((a, b) => Number(b.created_time ?? 0) - Number(a.created_time ?? 0))[0]
  const exact = newestNamed(parseTokenItems(await readSuccess(listed)))
  let id: string | number
  if (exact?.id === undefined) {
    const expires = config.tokenExpiresDays === 0 ? -1 : Math.floor(Date.now() / 1000) + config.tokenExpiresDays * 86400
    const created = await fetchWithRetry(`${admin}/token/`, { method: 'POST', headers, body: JSON.stringify({ name, group: config.userGroup, quota: config.tokenQuota, unlimited_quota: config.tokenUnlimitedQuota, expired_time: expires, model_limits_enabled: config.modelLimitsEnabled, model_limits: config.modelLimitsEnabled ? config.model : '', ip_whitelist: '', remarks: 'dsh managed credential' }) }, config)
    // New-API commonly acknowledges creation with `data: null`; the token is
    // still committed upstream and must be resolved by the exact-name lookup.
    const value = (await readSuccess(created) ?? {}) as { id?: string | number; key?: string }
    if (typeof value.key === 'string' && value.id !== undefined) return { token: value.key, externalTokenId: String(value.id) }
    const refreshed = await fetchWithRetry(`${admin}/token/?p=0&page_size=50&name=${encodeURIComponent(name)}`, { method: 'GET', headers }, config)
    const found = newestNamed(parseTokenItems(await readSuccess(refreshed)))
    id = found?.id ?? ''
    if (id === '') throw new ModelKeyError('MODEL_KEYS_UNAVAILABLE', 'new-api token creation did not return an id')
  } else id = exact.id
  const keyResponse = await fetchWithRetry(`${admin}/token/${encodeURIComponent(String(id))}/key`, { method: 'POST', headers }, config)
  const keyValue = await readSuccess(keyResponse) as { key?: string; data?: { key?: string } }
  const token = keyValue.data?.key ?? keyValue.key
  if (typeof token !== 'string') throw new ModelKeyError('MODEL_KEYS_UNAVAILABLE', 'new-api key response did not include data.key')
  return { token, externalTokenId: String(id) }
}

async function revokeNewApiToken(config: NonNullable<Config['newApi']>, id: string): Promise<void> {
  const headers = await loginAdmin(config)
  const response = await fetchWithRetry(`${config.adminUrl.replace(/\/$/, '')}/token/${encodeURIComponent(id)}`, { method: 'DELETE', headers }, config)
  await readSuccess(response)
}

async function fetchWithRetry(url: string, init: RequestInit, config: NonNullable<Config['newApi']>): Promise<Response> {
  let last: unknown
  for (let attempt = 0; attempt <= config.retries; attempt++) {
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(config.timeoutMs) })
      if (!response.ok) {
        if (![408, 429].includes(response.status) && (response.status < 500 || response.status > 599)) throw new ModelKeyError('MODEL_KEYS_UNAVAILABLE', `new-api request rejected (${response.status})`)
        throw new Error(`new-api request failed (${response.status})`)
      }
      return response
    } catch (error) {
      if (error instanceof ModelKeyError && error.cause === undefined) throw error
      last = error
      if (attempt < config.retries) await new Promise(resolve => setTimeout(resolve, Math.min(250, 25 * (attempt + 1))))
    }
  }
  throw new ModelKeyError('MODEL_KEYS_UNAVAILABLE', 'new-api token management failed', last)
}

async function loginAdmin(config: NonNullable<Config['newApi']>): Promise<Record<string, string>> {
  const response = await fetchWithRetry(`${config.adminUrl.replace(/\/$/, '')}/user/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: config.username, password: config.password }) }, config)
  const login = await readSuccess(response) as { id?: string | number; user?: { id?: string | number } }
  const externalUser = String(login.user?.id ?? login.id ?? '')
  if (externalUser.length === 0) throw new ModelKeyError('MODEL_KEYS_UNAVAILABLE', 'new-api login did not return user id')
  const raw = response.headers.get('set-cookie') ?? ''
  const cookie = raw.split(/,(?=[^;=]+=[^;]+)/).map(part => part.trim().split(';', 1)[0]).filter(Boolean).join('; ')
  return { 'content-type': 'application/json', cookie, 'New-Api-User': externalUser }
}

function parseTokenItems(value: unknown): Array<{ id?: string | number; name?: string; created_time?: string | number }> {
  if (Array.isArray(value)) return value as Array<{ id?: string | number; name?: string; created_time?: string | number }>
  if (typeof value === 'object' && value !== null && Array.isArray((value as { items?: unknown }).items)) return (value as { items: Array<{ id?: string | number; name?: string; created_time?: string | number }> }).items
  throw new ModelKeyError('MODEL_KEYS_UNAVAILABLE', 'new-api token list response is invalid')
}

async function readSuccess(response: Response): Promise<unknown> {
  const value = await response.json() as { success?: boolean; message?: string; data?: unknown }
  if (value.success !== true) throw new ModelKeyError('MODEL_KEYS_UNAVAILABLE', `new-api rejected request: ${value.message ?? 'success=false'}`)
  return value.data
}
