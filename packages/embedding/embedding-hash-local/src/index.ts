/** Offline deterministic feature-hashing provider for embedding development and tests. */
import { type Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { EmbeddingProvider, EmbeddingResult } from '@deepseek-ai/dsh-embedding'

/** Cordis plugin name. */
export const name = 'embedding-hash-local'
/** Service required by this provider plugin. */
export const inject = ['embedding']

/** Configuration for the local hash provider. */
export interface HashEmbeddingConfig {
  /** Registry id. Defaults to `hash-local`. */
  readonly id?: string
  /** Output vector dimensions. Must be a positive integer. */
  readonly dimensions?: number
}

/** Runtime schema for {@link HashEmbeddingConfig}. */
export const Config: z<HashEmbeddingConfig> = z.object({
  id: z.string().default('hash-local'),
  dimensions: z.number().step(1).min(1).default(384),
})

/**
 * Deterministic local feature-hashing provider. It is suitable for offline
 * development and tests only; hash proximity is not semantic model quality.
 */
export class HashEmbeddingProvider implements EmbeddingProvider {
  /** Provider registry id. */
  readonly id: string
  /** Number of coordinates in each generated vector. */
  readonly dimensions: number
  /** Construct a provider with validated dimensions and stable identity. */
  constructor(config: HashEmbeddingConfig = {}) {
    this.id = config.id ?? 'hash-local'
    this.dimensions = config.dimensions ?? 384
    if (this.id.length === 0) throw new Error('embedding provider id must be non-empty')
    if (!Number.isInteger(this.dimensions) || this.dimensions < 1) throw new Error('embedding dimensions must be a positive integer')
  }

  /** This offline provider is always locally available. */
  available(): boolean { return true }

  /** Hash each document into a normalized vector in input order. */
  embedDocuments(documents: readonly string[], signal?: AbortSignal): Promise<EmbeddingResult> {
    const vectors: readonly (readonly number[])[] = documents.map((document, index) => {
      if ((index & 31) === 0) signal?.throwIfAborted()
      return hash(document, this.dimensions)
    })
    signal?.throwIfAborted()
    return Promise.resolve({ vectors, identity: this.identity() })
  }

  /** Hash one query into the same normalized vector space. */
  async embedQuery(query: string, signal?: AbortSignal): Promise<EmbeddingResult> {
    signal?.throwIfAborted()
    const result = await this.embedDocuments([query], signal)
    return result
  }

  private identity() {
    return { model: this.id, revision: 'feature-hash-v1', dimensions: this.dimensions } as const
  }
}

/** Load the provider and register it with effect-scoped disposal. */
export function apply(ctx: Context, config: HashEmbeddingConfig = {}): () => void {
  return ctx.embedding.registerProvider(new HashEmbeddingProvider(config))
}

function hash(input: string, dimensions: number): readonly number[] {
  const vector = new Float64Array(dimensions)
  let hashValue = 2166136261
  for (const byte of new TextEncoder().encode(input)) {
    hashValue ^= byte
    hashValue = Math.imul(hashValue, 16777619)
    const bucket = (hashValue >>> 0) % dimensions
    vector[bucket] = (vector[bucket] ?? 0) + ((hashValue & 1) === 0 ? 1 : -1)
  }
  let norm = 0
  for (const value of vector) norm += value * value
  if (norm === 0) return Array.from(vector)
  norm = Math.sqrt(norm)
  return Array.from(vector, value => value / norm)
}
