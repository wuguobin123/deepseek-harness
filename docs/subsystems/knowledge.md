# Tenant-scoped knowledge retrieval

English | [中文](knowledge.zh.md)

The knowledge capability spans three plugin roles: [`dsh-knowledge`](../../packages/knowledge/knowledge) defines `ctx.knowledge`, [`dsh-knowledge-sqlite-local`](../../packages/knowledge/knowledge-sqlite-local) provides local ingestion and hybrid retrieval, and [`dsh-tool-knowledge`](../../packages/knowledge/tool-knowledge) exposes cited evidence to the model. Embedding is a separate seam because embedding providers and knowledge storage evolve independently.

Source: [`packages/knowledge/knowledge/src/types.ts`](../../packages/knowledge/knowledge/src/types.ts)

## KnowledgeScope

Every operation requires both a branded tenant id and a branded subject id supplied by a trusted caller. The model-facing schema contains neither field. The local provider includes both values in every knowledge-base, document, job, chunk, full-text, vector, deletion, and lookup predicate; a guessed id from another scope therefore behaves as absent.

The MVP Consumer maps the authenticated session `ownerId` to both values. This deliberately supports personal knowledge first without weakening the storage key needed for future organization membership and delegated subjects.

## KnowledgeBase and KnowledgeBaseInput

A knowledge base is named inside one scope. Its opaque `KnowledgeBaseId` is never sufficient authorization by itself.

## KnowledgeDocumentInput

Ingestion receives metadata plus an `AsyncIterable<Uint8Array>`. `ctx.knowledge` enforces the configured byte limit while the provider consumes the stream, avoiding an unbounded whole-file buffer. The local MVP accepts UTF-8 plain text and Markdown, creates immutable revision and chunk identifiers, and publishes search rows only after processing succeeds.

## KnowledgeIngestJob and KnowledgeIngestJobId

Ingestion is represented as a job with `queued`, `running`, `succeeded`, `failed`, or `cancelled` state. A job lookup requires the same complete scope as creation.

## KnowledgeSearchRequest and KnowledgeSearchResult

A search can target selected knowledge bases or all bases visible in the scope. An explicitly empty knowledge-base list means no results. The runtime caps `maxResults`; the provider combines FTS5 relevance with cosine similarity only when the query vector's model, revision, and dimensions match the stored index identity.

Each hit is a stable citation containing knowledge-base, document, revision and chunk ids, title, structured location, excerpt, content hash, index revision, and score. `knowledge_search` presents these as `[K1]`, `[K2]`, and stable `knowledge://...` locators. Retrieved text is untrusted data, not executable instructions.

## KnowledgeProvider

Providers own persistence, parsing, indexing, ranking, and enforcement of the supplied scope. They must keep state changes transactionally consistent and honor the passed `AbortSignal`. The local provider is an MVP for a single process; distributed workers, resumable uploads, richer parsers, encryption at rest, production semantic embeddings, evaluation, and organization authorization remain later layers.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxknowledge--knowledgeruntime"></a>

### `ctx.knowledge` — `KnowledgeRuntime`

Provider registry and scoped operation facade for `ctx.knowledge`.

```ts cordis-catalog
/**
 * Register a provider under its stable id.
 * @param provider - Scoped knowledge implementation.
 * @returns HMR/fiber disposer that unregisters the provider.
 */
registerProvider(provider: KnowledgeProvider): () => void

/**
 * Create a knowledge base in the caller's scope.
 * @param scope - Trusted tenant and subject scope.
 * @param input - Knowledge-base metadata.
 * @param signal - Cancellation signal forwarded unchanged.
 * @returns The created scoped knowledge base.
 */
async createKnowledgeBase(scope: KnowledgeScope, input: KnowledgeBaseInput, signal: AbortSignal): Promise<KnowledgeBase>

/**
 * List knowledge bases visible in the caller's scope.
 * @param scope - Trusted tenant and subject scope.
 * @param signal - Cancellation signal forwarded unchanged.
 * @returns Knowledge bases visible in the complete scope.
 */
async listKnowledgeBases(scope: KnowledgeScope, signal: AbortSignal): Promise<readonly KnowledgeBase[]>

/**
 * Start document ingestion in the caller's scope.
 * @param scope - Trusted tenant and subject scope.
 * @param input - Streaming document and metadata.
 * @param signal - Cancellation signal forwarded unchanged.
 * @returns The initial asynchronous ingestion job state.
 */
async startIngest(scope: KnowledgeScope, input: KnowledgeDocumentInput, signal: AbortSignal): Promise<KnowledgeIngestJob>

/**
 * Read an ingestion job in the caller's scope.
 * @param scope - Trusted tenant and subject scope.
 * @param jobId - Opaque ingestion job id.
 * @param signal - Cancellation signal forwarded unchanged.
 * @returns Current job state visible in the complete scope.
 */
async getIngestJob(scope: KnowledgeScope, jobId: KnowledgeIngestJobId, signal: AbortSignal): Promise<KnowledgeIngestJob>

/**
 * Search and enforce the configured maximum result count.
 * @param scope - Trusted tenant and subject scope.
 * @param request - Query, optional base selection, and requested bound.
 * @param signal - Cancellation signal forwarded unchanged.
 * @returns Bounded provider-independent citations.
 */
async search(scope: KnowledgeScope, request: KnowledgeSearchRequest, signal: AbortSignal): Promise<KnowledgeSearchResult>

/**
 * Delete a document in the caller's scope.
 * @param scope - Trusted tenant and subject scope.
 * @param documentId - Opaque document id resolved within the scope.
 * @param signal - Cancellation signal forwarded unchanged.
 * @returns Nothing after the scoped deletion completes.
 */
async deleteDocument(scope: KnowledgeScope, documentId: KnowledgeDocumentId, signal: AbortSignal): Promise<void>
```

Source: [`packages/knowledge/knowledge/src/index.ts`](../../packages/knowledge/knowledge/src/index.ts)
<!-- END GENERATED cordis-surface -->
