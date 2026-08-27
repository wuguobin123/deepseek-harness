/** Vocabulary for the embedding capability seam. */
import { HarnessError } from '@deepseek-ai/dsh-llm'

/** Stable identity of the model implementation producing vectors. */
export interface EmbeddingIdentity {
  /** Provider/model name. */
  readonly model: string
  /** Explicit model revision or index-compatible revision. */
  readonly revision: string
  /** Number of coordinates in every vector. */
  readonly dimensions: number
}

/** Result of embedding a batch of documents or one query. */
export interface EmbeddingResult {
  /** Vectors in input order. */
  readonly vectors: readonly (readonly number[])[]
  /** Traceable model and vector-space identity. */
  readonly identity: EmbeddingIdentity
}

/** Provider implementation registered on {@link EmbeddingRuntime}. */
export interface EmbeddingProvider {
  /** Stable unique provider id. */
  readonly id: string
  /** Cheap local usability check; must not perform network I/O. */
  available(): boolean
  /** Embed documents in input order. */
  embedDocuments(documents: readonly string[], signal?: AbortSignal): Promise<EmbeddingResult>
  /** Embed one query in the same vector space as documents. */
  embedQuery(query: string, signal?: AbortSignal): Promise<EmbeddingResult>
}

/** Machine-routable embedding capability failure. */
export class EmbeddingError extends HarnessError {}
