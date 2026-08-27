/** Provider-selecting Service Definition for document and query embeddings. */
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { EmbeddingProvider, EmbeddingResult } from './types.ts'
import { EmbeddingError } from './types.ts'

export type { EmbeddingIdentity, EmbeddingProvider, EmbeddingResult } from './types.ts'
export { EmbeddingError } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { embedding: EmbeddingRuntime }
}

/** Runtime selection configuration. */
export interface EmbeddingRuntimeConfig {
  /** Explicit provider id; omitted requires exactly one usable provider. */
  readonly provider?: string
}

/** Embedding registry and execution service. */
export class EmbeddingRuntime extends Service {
  static Config: z<EmbeddingRuntimeConfig> = z.object({ provider: z.string() })
  private readonly providers = new Map<string, EmbeddingProvider>()
  private readonly providerId: string | undefined

  /** Create the registry with an optional explicit provider selection. */
  constructor(ctx: Context, config: EmbeddingRuntimeConfig = {}) {
    super(ctx, 'embedding')
    this.providerId = config.provider ?? process.env.DSH_EMBEDDING_PROVIDER
  }

  /**
   * Register a provider and return its effect-scoped disposer.
   * @param provider - Provider registered under its stable id.
   * @returns Disposer that unregisters this contribution.
   */
  registerProvider(provider: EmbeddingProvider): () => void {
    if (this.providers.has(provider.id)) throw new EmbeddingError(`embedding provider "${provider.id}" is already registered`, 'EMBEDDING_DUPLICATE_PROVIDER')
    const dispose = this.ctx.effect(function* (this: EmbeddingRuntime) {
      this.providers.set(provider.id, provider)
      yield () => this.providers.delete(provider.id)
    }.bind(this), 'embedding.registerProvider()')
    return () => void dispose()
  }

  /**
   * Embed documents through the selected provider.
   * @param documents - Document strings in result-vector order.
   * @param signal - Optional cancellation signal forwarded unchanged.
   * @returns Vectors and their shared vector-space identity.
   */
  async embedDocuments(documents: readonly string[], signal?: AbortSignal): Promise<EmbeddingResult> {
    signal?.throwIfAborted()
    return resolveProvider(this.providers, this.providerId).embedDocuments(documents, signal)
  }

  /**
   * Embed one query through the selected provider.
   * @param query - Query text to embed.
   * @param signal - Optional cancellation signal forwarded unchanged.
   * @returns One vector and its vector-space identity.
   */
  async embedQuery(query: string, signal?: AbortSignal): Promise<EmbeddingResult> {
    signal?.throwIfAborted()
    return resolveProvider(this.providers, this.providerId).embedQuery(query, signal)
  }
}

function resolveProvider(providers: ReadonlyMap<string, EmbeddingProvider>, configuredId?: string): EmbeddingProvider {
  if (configuredId !== undefined) {
    const provider = providers.get(configuredId)
    if (provider === undefined) throw new EmbeddingError(`configured embedding provider "${configuredId}" is not registered`, 'EMBEDDING_CONFIGURED_MISSING')
    if (!provider.available()) throw new EmbeddingError(`configured embedding provider "${configuredId}" is unavailable`, 'EMBEDDING_CONFIGURED_UNAVAILABLE')
    return provider
  }
  const usable = [...providers.values()].filter(provider => provider.available())
  if (usable.length === 0) throw new EmbeddingError('no usable embedding provider is registered', 'EMBEDDING_UNAVAILABLE')
  if (usable.length > 1) throw new EmbeddingError(`multiple usable embedding providers are registered (${usable.map(p => p.id).join(', ')}); configure one explicitly`, 'EMBEDDING_AMBIGUOUS')
  const provider = usable[0]
  if (provider === undefined) throw new EmbeddingError('no usable embedding provider is registered', 'EMBEDDING_UNAVAILABLE')
  return provider
}

export default EmbeddingRuntime
