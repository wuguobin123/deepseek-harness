/** Account-scoped model route that reserves and settles wallet balance per provider attempt. */
import { randomUUID } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm'
import { PiAiAdapter, authContextFrom, credentialStoreFrom, resolveProfiles } from '@deepseek-ai/dsh-llm-pi-ai'
import type { ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import type { UserId } from '@deepseek-ai/dsh-account-identity'
import '@deepseek-ai/dsh-account-wallet'
import { CUSTOM_MODEL_PROVIDER_ROUTE } from '@deepseek-ai/dsh-account-model-keys'
import '@deepseek-ai/dsh-session'
import '@deepseek-ai/dsh-llm-pi-ai'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Resolve an account model request's credential before the provider call.
     * Listeners may supply an account credential or delegate to the next resolver.
     * @mode waterfall
     * @param request Account model request and selected provider profile.
     * @param next Continue credential resolution.
     */
    'llm-pi-ai/resolve-api-key'(
      request: { provider: string; profile: ResolvedPiAiProviderProfile; options: GenerateOptions },
      next: () => Promise<string | undefined>,
    ): Promise<string | undefined>
  }
}

interface ActiveModelCredential {
  readonly token: string
  readonly route: string
  readonly model: string
  readonly inputPriceMicrosPerToken: number
  readonly outputPriceMicrosPerToken: number
}
interface WalletApi {
  reserve(input: {
    userId: UserId
    reservationId: string
    amountMicros: number
  }): Promise<{ reservationId: string; reservedMicros: number }>
  cancel(input: { userId: UserId; reservationId: string }): Promise<unknown>
  settle(input: {
    userId: UserId
    reservationId: string
    actualMicros: number
    idempotencyKey: string
  }): Promise<unknown>
}
interface CustomModel {
  readonly customModelId: string
  readonly userId: UserId
  readonly label: string
  readonly api: 'openai-completions' | 'openai-responses'
  readonly baseURL: string
  readonly upstreamModel: string
  readonly revoked: number | null
  readonly apiKey: string
}
interface KeysApi {
  resolveActive(input: { userId: UserId; route?: string }): Promise<ActiveModelCredential | undefined>
  provision(input: { userId: UserId }): Promise<unknown>
  resolveCustom(input: { userId: UserId; customModelId: string }): Promise<CustomModel | undefined>
}
/** Credential handoff is process-local and never enters a request/event log. */
const accountCredential = new AsyncLocalStorage<string>()
/** Explicit owner for the session-free account inference route. */
const accountInferenceOwner = new WeakMap<object, UserId>()

/** Configures one account-billed model route. */
export interface Config {
  /** Account model route used for provider credential lookup. */
  route: string
  /** Default upstream model identifier. */
  model: string
  /** HTTPS host allow-list for account-owned custom models. */
  customModelAllowedHosts?: string[]
  /** Behavior when usage is unavailable after reservation. */
  missingUsagePolicy?: 'reserve' | 'cancel'
  /** Output-token estimate used when a request omits its limit. */
  fallbackMaxOutputTokens?: number
  /** Conservative token allowance for provider-owned cached prefixes absent from request JSON. */
  providerCacheReadReserveTokens?: number
}
export const Config: z<Config> = z.object({
  route: z.string().min(1).required(), model: z.string().min(1).required(), missingUsagePolicy: z.union([z.const('reserve'), z.const('cancel')]).default('reserve'),
  customModelAllowedHosts: z.array(z.string().min(1)).default([]),
  fallbackMaxOutputTokens: z.number().step(1).min(1).max(1_000_000).default(4096),
  providerCacheReadReserveTokens: z.number().step(1).min(0).max(1_000_000).default(4096),
})

/** Cordis plugin name. */
export const name = 'llm-account-platform'
/** Services required by the account consumer and its credential handoff. */
export const inject = ['llm', 'sessions', 'wallet', 'userModelKeys']

declare module '@deepseek-ai/cordis' {
  interface Context { accountPlatform: AccountPlatformService }
}

/** Service marker for the account-platform consumer. */
export abstract class AccountPlatformService extends Service {
  constructor(ctx: Context) { super(ctx, 'accountPlatform') }

  /** Stream one account-owned request without creating or reading a Session. */
  abstract streamForAccount(userId: UserId, options: Omit<GenerateOptions, 'sessionId' | 'provider'> & { provider?: string }, signal?: AbortSignal): AsyncIterable<StreamChunk>
}

function estimate(options: GenerateOptions, credential: ActiveModelCredential, config: Config): number {
  const bytes = Buffer.byteLength(JSON.stringify({ system: options.system, messages: options.messages, tools: options.tools }))
  // The serialized request byte count is a conservative token ceiling for
  // the model protocols this route accepts. Settlement refunds the unused hold.
  const input = Math.max(1, bytes) + (config.providerCacheReadReserveTokens ?? 4096)
  const output = options.maxTokens ?? config.fallbackMaxOutputTokens ?? 4096
  return input * credential.inputPriceMicrosPerToken + output * credential.outputPriceMicrosPerToken || 1
}

function usageCost(usage: TokenUsage, credential: ActiveModelCredential): number {
  const input = usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
  return input * credential.inputPriceMicrosPerToken + usage.outputTokens * credential.outputPriceMicrosPerToken
}

/** Mount the account route consumer and the process-local pi-ai credential handoff. */
export function apply(ctx: Context, config: Config): void {
  let disposed = false
  const settlements = new Set<Promise<void>>()
  const customRoute = CUSTOM_MODEL_PROVIDER_ROUTE
  const allowedHosts = new Set((config.customModelAllowedHosts ?? []).map(host => host.toLowerCase()))
  const isPrivateAddress = (address: string): boolean => {
    if (isIP(address) === 6) {
      const value = address.toLowerCase()
      return value === '::1' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb') || value === '::'
    }
    if (isIP(address) === 4) {
      const octets = address.split('.').map(Number)
      const [first, second] = octets
      return first === 0
        || first === 10
        || first === 127
        || (first === 100 && second !== undefined && second >= 64 && second <= 127)
        || (first === 169 && second === 254)
        || (first === 172 && second !== undefined && second >= 16 && second <= 31)
        || (first === 192 && (second === 0 || second === 168))
        || (first === 198 && (second === 18 || second === 19 || second === 51))
        || (first === 203 && second === 0)
        || first !== undefined && first >= 224
    }
    return true
  }
  const validateCustomURL = async (baseURL: string): Promise<void> => {
    let parsed: URL
    try { parsed = new URL(baseURL) } catch { throw new LlmError('custom model base URL is invalid', 'CUSTOM_MODEL_URL_INVALID') }
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
    if (
      parsed.protocol !== 'https:'
      || parsed.username !== ''
      || parsed.password !== ''
      || parsed.hash !== ''
      || host.length === 0
      || host === 'localhost'
      || host.endsWith('.localhost')
      || host.endsWith('.local')
      || (isIP(host) === 0 && host.indexOf('.') < 0)
      || (allowedHosts.size > 0 && !allowedHosts.has(host))
    ) {
      throw new LlmError('custom model base URL must use a public HTTPS host', 'CUSTOM_MODEL_URL_INVALID')
    }
    let addresses: readonly { address: string }[]
    try {
      addresses = await lookup(host, { all: true, order: 'verbatim' })
    } catch {
      throw new LlmError('custom model base URL host could not be resolved', 'CUSTOM_MODEL_URL_INVALID')
    }
    if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
      throw new LlmError('custom model base URL resolves to a private or metadata address', 'CUSTOM_MODEL_URL_INVALID')
    }
  }
  const customAdapter = new (class extends LlmAdapter {
    override stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      return (async function* (): AsyncGenerator<StreamChunk> {
        if (options.sessionId === undefined) throw new LlmError('custom model requires a session', 'ACCOUNT_REQUIRED')
        const session = ctx.sessions.get(options.sessionId)
        const ownerId = session?.header.ownerId as unknown as UserId | undefined
        if (ownerId === undefined) throw new LlmError('custom model requires an account-owned session', 'ACCOUNT_REQUIRED')
        const customModelId = options.model
        const custom = await (ctx.get('userModelKeys') as unknown as KeysApi).resolveCustom({
          userId: ownerId,
          customModelId,
        })
        if (custom === undefined || custom.userId !== ownerId || custom.revoked !== null) {
          throw new LlmError('custom model is unavailable', 'CUSTOM_MODEL_UNAVAILABLE')
        }
        await validateCustomURL(custom.baseURL)
        const profile = resolveProfiles({
          [customRoute]: {
            displayName: custom.label,
            api: custom.api,
            baseURL: custom.baseURL,
            models: [{ id: custom.upstreamModel, name: custom.label }],
          },
        }).get(customRoute) as ResolvedPiAiProviderProfile
        const adapter = new PiAiAdapter({
          profiles: () => new Map([[customRoute, profile]]),
          resolveApiKey: () => Promise.resolve(custom.apiKey),
          auth: { credentials: credentialStoreFrom(ctx), authContext: authContextFrom(ctx) },
        })
        for await (const chunk of adapter.stream({ ...options, provider: customRoute, model: custom.upstreamModel })) yield chunk
      })()
    }
  })()
  ctx.llm.registerAdapter([customRoute], customAdapter)
  const resolve = async (options: GenerateOptions): Promise<{ userId: UserId; credential: ActiveModelCredential }> => {
    const explicitOwner = accountInferenceOwner.get(options)
    const session = options.sessionId === undefined ? undefined : ctx.sessions.get(options.sessionId)
    const ownerId = explicitOwner ?? session?.header.ownerId as unknown as UserId | undefined
    if (ownerId === undefined) throw new LlmError('account platform requires an account-owned session', 'ACCOUNT_REQUIRED')
    const keys = ctx.get('userModelKeys') as unknown as KeysApi
    let credential = await keys.resolveActive({ userId: ownerId, route: config.route })
    if (credential === undefined) {
      await keys.provision({ userId: ownerId })
      credential = await keys.resolveActive({ userId: ownerId, route: config.route })
    }
    if (credential === undefined || credential.route !== config.route || credential.model !== config.model) {
      throw new LlmError(
        'account model credential does not match configured route/model',
        'ACCOUNT_CREDENTIAL_MISMATCH',
      )
    }
    return { userId: ownerId, credential }
  }
  ctx.on('llm-pi-ai/resolve-api-key', (_request, next) => {
    const token = accountCredential.getStore()
    return token === undefined ? next() : Promise.resolve(token)
  })
  ctx.on('llm/stream', (options, next) => {
    if (options.provider === customRoute) return next()
    if (options.provider !== config.route) return next()
    if (disposed) throw new LlmError('account platform is shutting down', 'ACCOUNT_PLATFORM_UNAVAILABLE')
    return (async function* (): AsyncGenerator<StreamChunk> {
      const { userId, credential } = await resolve(options)
      const wallet = ctx.get('wallet') as unknown as WalletApi
      // Wallet operation keys are capped at 64 characters. Session ids are
      // opaque and may already consume that budget, so they cannot be embedded
      // in the key. A UUID keeps each provider attempt unique at fixed length.
      const reserved = await wallet.reserve({ userId, reservationId: `llm:${randomUUID()}`, amountMicros: estimate(options, credential, config) })
      let usage: TokenUsage | undefined
      let terminal: Extract<StreamChunk, { type: 'finish' }> | undefined
      let finalized = false
      const finalize = async (): Promise<void> => {
        if (finalized) return
        finalized = true
        const settling = usage === undefined && config.missingUsagePolicy === 'cancel'
          ? wallet.cancel({ userId, reservationId: reserved.reservationId }).then(() => undefined)
          : wallet.settle({ userId, reservationId: reserved.reservationId, actualMicros: usage === undefined ? reserved.reservedMicros : usageCost(usage, credential), idempotencyKey: `settle:${reserved.reservationId}` }).then(() => undefined)
        settlements.add(settling)
        try { await settling } finally { settlements.delete(settling) }
      }
      try {
        const iterator = next()[Symbol.asyncIterator]()
        let exhausted = false
        try {
          while (true) {
            const item = await accountCredential.run(credential.token, () => iterator.next())
            if (item.done) {
              exhausted = true
              break
            }
            const chunk = item.value
            if (chunk.type === 'usage') usage = chunk.usage
            if (chunk.type === 'finish') {
              terminal = chunk
              break
            }
            yield chunk
          }
        } finally {
          if (!exhausted) {
            const close = iterator.return?.bind(iterator)
            if (close !== undefined) await accountCredential.run(credential.token, close)
          }
        }
        await finalize()
        if (terminal !== undefined) yield terminal
      } finally {
        await finalize()
      }
    })()
  })
  // The HTTP inference route uses this narrow service face. The owner is
  // supplied by the authenticated carrier and is never inferred from wire data.
  ctx.provide('accountPlatform', {
    streamForAccount(userId: UserId, options: Omit<GenerateOptions, 'sessionId' | 'provider'> & { provider?: string }, signal?: AbortSignal): AsyncIterable<StreamChunk> {
      if (options.model !== config.model) {
        throw new LlmError('account inference model is unavailable', 'ACCOUNT_MODEL_UNAVAILABLE')
      }
      const request = {
        ...options,
        provider: options.provider ?? config.route,
        ...(signal === undefined ? {} : { signal }),
      } as GenerateOptions
      accountInferenceOwner.set(request, userId)
      return (async function* (): AsyncGenerator<StreamChunk> {
        try {
          for await (const chunk of ctx.llm.stream(request)) yield chunk
        } finally {
          accountInferenceOwner.delete(request)
        }
      })()
    },
  } as AccountPlatformService)
  ctx.effect(() => async () => { disposed = true; await Promise.all([...settlements]) }, 'account-platform.dispose')
}
