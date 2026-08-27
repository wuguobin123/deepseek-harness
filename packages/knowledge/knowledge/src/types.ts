/** Request and result vocabulary for the scoped knowledge capability. */

import type { Branded } from '@deepseek-ai/dsh-brand'
import { HarnessError } from '@deepseek-ai/dsh-llm'

/** Opaque tenant identifier supplied by a trusted caller. */
export type TenantId = Branded<'TenantId'>
/** Opaque subject identifier used to narrow a tenant's knowledge view. */
export type KnowledgeSubjectId = Branded<'KnowledgeSubjectId'>
/** Opaque knowledge-base identifier. */
export type KnowledgeBaseId = Branded<'KnowledgeBaseId'>
/** Opaque document identifier. */
export type KnowledgeDocumentId = Branded<'KnowledgeDocumentId'>
/** Opaque immutable document revision identifier. */
export type KnowledgeRevisionId = Branded<'KnowledgeRevisionId'>
/** Opaque indexed chunk identifier. */
export type KnowledgeChunkId = Branded<'KnowledgeChunkId'>
/** Opaque ingestion-job identifier. */
export type KnowledgeIngestJobId = Branded<'KnowledgeIngestJobId'>

/** Scope selected by an already-authenticated caller; providers must enforce it. */
export interface KnowledgeScope {
  readonly tenantId: TenantId
  readonly subjectId: KnowledgeSubjectId
}

/** Metadata used when creating a knowledge base. */
export interface KnowledgeBaseInput {
  readonly name: string
  readonly description?: string
}
/** A knowledge base visible within the supplied scope. */
export interface KnowledgeBase {
  readonly id: KnowledgeBaseId
  readonly name: string
  readonly description?: string
}

/** A bounded, streaming document body; providers must consume it incrementally. */
export type KnowledgeContent = AsyncIterable<Uint8Array>
/** Document metadata and content submitted to ingestion. */
export interface KnowledgeDocumentInput {
  readonly knowledgeBaseId: KnowledgeBaseId
  readonly title: string
  readonly contentType: string
  readonly content: KnowledgeContent
  /** Optional declared size, rejected before provider invocation when over the runtime limit. */
  readonly byteLength?: number
}
/** Lifecycle state of an asynchronous ingestion job. */
export type KnowledgeIngestJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
/** Status and optional failure information for an ingestion job. */
export interface KnowledgeIngestJob {
  readonly id: KnowledgeIngestJobId
  readonly status: KnowledgeIngestJobStatus
  readonly documentId?: KnowledgeDocumentId
  readonly revisionId?: KnowledgeRevisionId
  readonly error?: string
}

/** Search input; the runtime caps the requested result count before calling a provider. */
export interface KnowledgeSearchRequest {
  /** Omitted means all bases visible in the supplied scope. */
  readonly knowledgeBaseIds?: readonly KnowledgeBaseId[]
  readonly query: string
  readonly maxResults: number
}
/** Stable citation metadata returned for one indexed match. */
export interface KnowledgeCitation {
  readonly knowledgeBaseId: KnowledgeBaseId
  readonly documentId: KnowledgeDocumentId
  readonly revisionId: KnowledgeRevisionId
  readonly chunkId: KnowledgeChunkId
  readonly title: string
  readonly location: KnowledgeCitationLocation
  readonly excerpt: string
  readonly contentHash: string
  readonly indexRevision: string
  readonly score: number
}
/** Structured source position retained in a stable citation. */
export interface KnowledgeCitationLocation {
  readonly page?: number
  readonly section?: string
  readonly sourceUri?: string
}
/** Search result with provider-independent citations. */
export interface KnowledgeSearchResult {
  readonly hits: readonly KnowledgeCitation[]
  readonly truncated: boolean
}

/** Provider implementation for the knowledge capability. */
export interface KnowledgeProvider {
  readonly id: string
  /** Return a cheap local usability check without network I/O. */
  available(): boolean
  /** Create a knowledge base in the supplied scope. */
  createKnowledgeBase(scope: KnowledgeScope, input: KnowledgeBaseInput, signal: AbortSignal): Promise<KnowledgeBase>
  /** List knowledge bases visible in the supplied scope. */
  listKnowledgeBases(scope: KnowledgeScope, signal: AbortSignal): Promise<readonly KnowledgeBase[]>
  /** Start an asynchronous document ingestion job in the supplied scope. */
  startIngest(scope: KnowledgeScope, input: KnowledgeDocumentInput, signal: AbortSignal): Promise<KnowledgeIngestJob>
  /** Read an ingestion job in the supplied scope. */
  getIngestJob(scope: KnowledgeScope, jobId: KnowledgeIngestJobId, signal: AbortSignal): Promise<KnowledgeIngestJob>
  /** Search only documents visible in the supplied scope. */
  search(scope: KnowledgeScope, request: KnowledgeSearchRequest, signal: AbortSignal): Promise<KnowledgeSearchResult>
  /** Delete a document in the supplied scope. */
  deleteDocument(scope: KnowledgeScope, documentId: KnowledgeDocumentId, signal: AbortSignal): Promise<void>
}

/** Open-string, machine-routable error for knowledge operations. */
export class KnowledgeError extends HarnessError {}
