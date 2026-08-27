/** Service Definition for scoped knowledge-base storage, ingestion, and search. */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { KnowledgeError } from './types.ts'
import type {
  KnowledgeBase,
  KnowledgeBaseInput,
  KnowledgeDocumentId,
  KnowledgeDocumentInput,
  KnowledgeIngestJob,
  KnowledgeIngestJobId,
  KnowledgeProvider,
  KnowledgeScope,
  KnowledgeSearchRequest,
  KnowledgeSearchResult,
} from './types.ts'

export type * from './types.ts'
export { KnowledgeError } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { knowledge: KnowledgeRuntime }
}

/** Runtime configuration for provider selection and the enforced search bound. */
export interface KnowledgeRuntimeConfig {
  /** Provider id selected for knowledge operations. */
  readonly provider?: string
  /** Maximum number of search results returned by the runtime. */
  readonly maxResults?: number
  /** Maximum bytes accepted for one ingestion request. */
  readonly maxIngestBytes?: number
}

/** Provider registry and scoped operation facade for `ctx.knowledge`. */
export class KnowledgeRuntime extends Service {
  static Config: z<KnowledgeRuntimeConfig> = z.object({
    provider: z.string(),
    maxResults: z.number().default(20),
    maxIngestBytes: z.number().default(10 * 1024 * 1024),
  })

  private readonly providers = new Map<string, KnowledgeProvider>()
  private readonly providerId: string | undefined
  private readonly maxResults: number
  private readonly maxIngestBytes: number

  constructor(ctx: Context, config: KnowledgeRuntimeConfig = {}) {
    super(ctx, 'knowledge')
    this.providerId = config.provider ?? process.env.DSH_KNOWLEDGE_PROVIDER
    this.maxResults = config.maxResults ?? 20
    this.maxIngestBytes = config.maxIngestBytes ?? 10 * 1024 * 1024
    if (!Number.isInteger(this.maxResults) || this.maxResults < 1 || !Number.isInteger(this.maxIngestBytes) || this.maxIngestBytes < 1) {
      throw new KnowledgeError('maxResults and maxIngestBytes must be positive integers', 'KNOWLEDGE_INVALID_CONFIG')
    }
  }

  /**
   * Register a provider under its stable id.
   * @param provider - Scoped knowledge implementation.
   * @returns HMR/fiber disposer that unregisters the provider.
   */
  registerProvider(provider: KnowledgeProvider): () => void {
    if (this.providers.has(provider.id)) {
      throw new KnowledgeError(`knowledge provider "${provider.id}" is already registered`, 'KNOWLEDGE_DUPLICATE_PROVIDER')
    }
    const providers = this.providers
    const dispose = this.ctx.effect(function* () {
      providers.set(provider.id, provider)
      yield () => providers.delete(provider.id)
    }, 'knowledge.registerProvider()')
    return () => void dispose()
  }

  /**
   * Create a knowledge base in the caller's scope.
   * @param scope - Trusted tenant and subject scope.
   * @param input - Knowledge-base metadata.
   * @param signal - Cancellation signal forwarded unchanged.
   * @returns The created scoped knowledge base.
   */
  async createKnowledgeBase(scope: KnowledgeScope, input: KnowledgeBaseInput, signal: AbortSignal): Promise<KnowledgeBase> {
    return resolveProvider(this.providers, this.providerId).createKnowledgeBase(scope, input, signal)
  }
  /**
   * List knowledge bases visible in the caller's scope.
   * @param scope - Trusted tenant and subject scope.
   * @param signal - Cancellation signal forwarded unchanged.
   * @returns Knowledge bases visible in the complete scope.
   */
  async listKnowledgeBases(scope: KnowledgeScope, signal: AbortSignal): Promise<readonly KnowledgeBase[]> {
    return resolveProvider(this.providers, this.providerId).listKnowledgeBases(scope, signal)
  }
  /**
   * Start document ingestion in the caller's scope.
   * @param scope - Trusted tenant and subject scope.
   * @param input - Streaming document and metadata.
   * @param signal - Cancellation signal forwarded unchanged.
   * @returns The initial asynchronous ingestion job state.
   */
  async startIngest(scope: KnowledgeScope, input: KnowledgeDocumentInput, signal: AbortSignal): Promise<KnowledgeIngestJob> {
    const invalidDeclaredSize = input.byteLength !== undefined
      && (!Number.isInteger(input.byteLength) || input.byteLength < 0 || input.byteLength > this.maxIngestBytes)
    if (invalidDeclaredSize) {
      throw new KnowledgeError('declared document size exceeds maxIngestBytes', 'KNOWLEDGE_CONTENT_TOO_LARGE')
    }
    const limitedContent = limitContent(input.content, this.maxIngestBytes)
    return resolveProvider(this.providers, this.providerId).startIngest(scope, { ...input, content: limitedContent }, signal)
  }
  /**
   * Read an ingestion job in the caller's scope.
   * @param scope - Trusted tenant and subject scope.
   * @param jobId - Opaque ingestion job id.
   * @param signal - Cancellation signal forwarded unchanged.
   * @returns Current job state visible in the complete scope.
   */
  async getIngestJob(scope: KnowledgeScope, jobId: KnowledgeIngestJobId, signal: AbortSignal): Promise<KnowledgeIngestJob> {
    return resolveProvider(this.providers, this.providerId).getIngestJob(scope, jobId, signal)
  }
  /**
   * Search and enforce the configured maximum result count.
   * @param scope - Trusted tenant and subject scope.
   * @param request - Query, optional base selection, and requested bound.
   * @param signal - Cancellation signal forwarded unchanged.
   * @returns Bounded provider-independent citations.
   */
  async search(scope: KnowledgeScope, request: KnowledgeSearchRequest, signal: AbortSignal): Promise<KnowledgeSearchResult> {
    if (request.query.trim().length === 0 || !Number.isInteger(request.maxResults) || request.maxResults < 1) {
      throw new KnowledgeError('query must be non-empty and maxResults must be a positive integer', 'KNOWLEDGE_INVALID_REQUEST')
    }
    const maxResults = Math.min(request.maxResults, this.maxResults)
    const result = await resolveProvider(this.providers, this.providerId).search(scope, { ...request, maxResults }, signal)
    if (result.hits.length <= maxResults) return result
    return { ...result, hits: result.hits.slice(0, maxResults), truncated: true }
  }
  /**
   * Delete a document in the caller's scope.
   * @param scope - Trusted tenant and subject scope.
   * @param documentId - Opaque document id resolved within the scope.
   * @param signal - Cancellation signal forwarded unchanged.
   * @returns Nothing after the scoped deletion completes.
   */
  async deleteDocument(scope: KnowledgeScope, documentId: KnowledgeDocumentId, signal: AbortSignal): Promise<void> {
    return resolveProvider(this.providers, this.providerId).deleteDocument(scope, documentId, signal)
  }
}

async function* limitContent(content: AsyncIterable<Uint8Array>, maxBytes: number): AsyncIterable<Uint8Array> {
  let total = 0
  for await (const chunk of content) {
    total += chunk.byteLength
    if (total > maxBytes) throw new KnowledgeError('document content exceeds maxIngestBytes', 'KNOWLEDGE_CONTENT_TOO_LARGE')
    yield chunk
  }
}

function resolveProvider(providers: ReadonlyMap<string, KnowledgeProvider>, configuredId?: string): KnowledgeProvider {
  if (configuredId !== undefined) {
    const provider = providers.get(configuredId)
    if (!provider) throw new KnowledgeError(`configured knowledge provider "${configuredId}" is not registered`, 'KNOWLEDGE_PROVIDER_CONFIGURED_MISSING')
    if (!provider.available()) throw new KnowledgeError(`configured knowledge provider "${configuredId}" is unavailable`, 'KNOWLEDGE_PROVIDER_CONFIGURED_UNAVAILABLE')
    return provider
  }
  const usable = [...providers.values()].filter(provider => provider.available())
  if (usable.length === 0) throw new KnowledgeError('no usable knowledge provider is registered', 'KNOWLEDGE_PROVIDER_UNAVAILABLE')
  if (usable.length > 1) throw new KnowledgeError(`multiple usable knowledge providers are registered (${usable.map(provider => provider.id).join(', ')})`, 'KNOWLEDGE_PROVIDER_AMBIGUOUS')
  const single = usable[0]
  if (single === undefined) throw new KnowledgeError('no usable knowledge provider is registered', 'KNOWLEDGE_PROVIDER_UNAVAILABLE')
  return single
}

export default KnowledgeRuntime
