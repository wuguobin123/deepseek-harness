/** Scope-enforcing SQLite knowledge provider. */
import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { EmbeddingResult, EmbeddingRuntime } from '@deepseek-ai/dsh-embedding'
import {
  KnowledgeError,
  type KnowledgeBase,
  type KnowledgeBaseId,
  type KnowledgeBaseInput,
  type KnowledgeChunkId,
  type KnowledgeDocumentId,
  type KnowledgeDocumentInput,
  type KnowledgeIngestJob,
  type KnowledgeIngestJobId,
  type KnowledgeProvider,
  type KnowledgeRevisionId,
  type KnowledgeScope,
  type KnowledgeSearchRequest,
  type KnowledgeSearchResult,
} from '@deepseek-ai/dsh-knowledge'
import { openKnowledgeDatabase, transaction } from './database.ts'
import { bm25Relevance, cosineSimilarity } from './ranking.ts'

/** Storage and ranking settings resolved by the plugin entrypoint. */
export interface SqliteKnowledgeOptions {
  readonly path?: string
  readonly id?: string
  readonly chunkChars?: number
  readonly chunkOverlapChars?: number
  readonly keywordWeight?: number
  readonly vectorWeight?: number
}

type EmbeddingClient = Pick<EmbeddingRuntime, 'embedDocuments' | 'embedQuery'>
type ProviderState = 'open' | 'closing' | 'closed'
type ResolvedOptions = Required<SqliteKnowledgeOptions>

interface BaseRow { readonly id: string; readonly name: string; readonly description: string | null }
interface JobRow {
  readonly id: string
  readonly status: KnowledgeIngestJob['status']
  readonly document_id: string | null
  readonly revision_id: string | null
  readonly error: string | null
}
interface ChunkRow {
  readonly id: string
  readonly document_id: string
  readonly revision_id: string
  readonly kb_id: string
  readonly title: string
  readonly content_hash: string
  readonly index_revision: string
  readonly model: string
  readonly model_revision: string
  readonly dimensions: number
  readonly text: string
  readonly vector: string
}
interface FtsRow { readonly chunk_id: string; readonly rank: number }

/** Local single-process provider with mandatory tenant-and-subject predicates. */
export class SqliteKnowledgeProvider implements KnowledgeProvider {
  readonly id: string
  private readonly db: DatabaseSync
  private readonly tasks = new Set<Promise<void>>()
  private readonly closeController = new AbortController()
  private readonly options: ResolvedOptions
  private state: ProviderState = 'open'
  private closePromise: Promise<void> | undefined

  /** Open storage and bind the provider to one embedding runtime. */
  constructor(
    options: SqliteKnowledgeOptions,
    private readonly embedding: EmbeddingClient,
  ) {
    this.options = resolveOptions(options)
    validateOptions(this.options)
    this.id = this.options.id
    this.db = openKnowledgeDatabase(this.options.path)
  }

  /** Return whether new operations may start. */
  available(): boolean { return this.state === 'open' }

  /**
   * Create a knowledge base inside exactly one scope.
   * @param scope - Trusted tenant and subject scope.
   * @param input - Knowledge-base metadata.
   * @param signal - Cancellation signal.
   * @returns The created scoped knowledge base.
   */
  createKnowledgeBase(
    scope: KnowledgeScope,
    input: KnowledgeBaseInput,
    signal: AbortSignal,
  ): Promise<KnowledgeBase> {
    this.assertOpen()
    signal.throwIfAborted()
    if (input.name.trim().length === 0) {
      return Promise.reject(new KnowledgeError('knowledge base name must be non-empty', 'KNOWLEDGE_INVALID_REQUEST'))
    }
    const id = randomUUID()
    this.db.prepare('INSERT INTO knowledge_bases VALUES (?, ?, ?, ?, ?)').run(
      id,
      scope.tenantId,
      scope.subjectId,
      input.name,
      input.description ?? null,
    )
    return Promise.resolve({
      id: id as KnowledgeBaseId,
      name: input.name,
      ...(input.description === undefined ? {} : { description: input.description }),
    })
  }

  /**
   * List only knowledge bases owned by the complete supplied scope.
   * @param scope - Trusted tenant and subject scope.
   * @param signal - Cancellation signal.
   * @returns Knowledge bases visible in the complete scope.
   */
  listKnowledgeBases(scope: KnowledgeScope, signal: AbortSignal): Promise<readonly KnowledgeBase[]> {
    this.assertOpen()
    signal.throwIfAborted()
    const rows = this.db.prepare(`
      SELECT id, name, description
      FROM knowledge_bases
      WHERE tenant_id = ? AND subject_id = ?
      ORDER BY id
    `).all(scope.tenantId, scope.subjectId) as unknown as BaseRow[]
    return Promise.resolve(rows.map(row => ({
      id: row.id as KnowledgeBaseId,
      name: row.name,
      ...(row.description === null ? {} : { description: row.description }),
    })))
  }

  /**
   * Persist a queued job and process its bounded stream in the background.
   * @param scope - Trusted tenant and subject scope.
   * @param input - Streaming document and metadata.
   * @param signal - Cancellation signal retained by the background job.
   * @returns Initial queued job state.
   */
  startIngest(
    scope: KnowledgeScope,
    input: KnowledgeDocumentInput,
    signal: AbortSignal,
  ): Promise<KnowledgeIngestJob> {
    this.assertOpen()
    signal.throwIfAborted()
    if (input.contentType !== 'text/plain' && input.contentType !== 'text/markdown') {
      return Promise.reject(new KnowledgeError('unsupported content type', 'KNOWLEDGE_UNSUPPORTED_CONTENT_TYPE'))
    }
    const found = this.db.prepare(`
      SELECT id FROM knowledge_bases
      WHERE id = ? AND tenant_id = ? AND subject_id = ?
    `).get(input.knowledgeBaseId, scope.tenantId, scope.subjectId)
    if (found === undefined) return Promise.reject(notFound('knowledge base'))

    const jobId = randomUUID()
    this.db.prepare('INSERT INTO jobs VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      jobId,
      scope.tenantId,
      scope.subjectId,
      input.knowledgeBaseId,
      'queued',
      null,
      null,
      null,
    )
    const task = this.process(scope, input, jobId, AbortSignal.any([signal, this.closeController.signal]))
    this.tasks.add(task)
    void task.finally(() => this.tasks.delete(task)).catch(() => {})
    return Promise.resolve({ id: jobId as KnowledgeIngestJobId, status: 'queued' })
  }

  /**
   * Read a job only through its complete scope key.
   * @param scope - Trusted tenant and subject scope.
   * @param jobId - Opaque ingestion job id.
   * @param signal - Cancellation signal.
   * @returns Current scoped job state.
   */
  getIngestJob(
    scope: KnowledgeScope,
    jobId: KnowledgeIngestJobId,
    signal: AbortSignal,
  ): Promise<KnowledgeIngestJob> {
    this.assertOpen()
    signal.throwIfAborted()
    const row = this.db.prepare(`
      SELECT id, status, document_id, revision_id, error
      FROM jobs
      WHERE id = ? AND tenant_id = ? AND subject_id = ?
    `).get(jobId, scope.tenantId, scope.subjectId) as unknown as JobRow | undefined
    if (row === undefined) return Promise.reject(notFound('ingest job'))
    return Promise.resolve({
      id: row.id as KnowledgeIngestJobId,
      status: row.status,
      ...(row.document_id === null ? {} : { documentId: row.document_id as KnowledgeDocumentId }),
      ...(row.revision_id === null ? {} : { revisionId: row.revision_id as KnowledgeRevisionId }),
      ...(row.error === null ? {} : { error: row.error }),
    })
  }

  /**
   * Search scoped chunks with compatible keyword and vector evidence.
   * @param scope - Trusted tenant and subject scope.
   * @param request - Query, optional base selection, and result bound.
   * @param signal - Cancellation signal forwarded to query embedding.
   * @returns Ranked stable citations from the complete scope.
   */
  async search(
    scope: KnowledgeScope,
    request: KnowledgeSearchRequest,
    signal: AbortSignal,
  ): Promise<KnowledgeSearchResult> {
    this.assertOpen()
    signal.throwIfAborted()
    if (request.knowledgeBaseIds?.length === 0) return { hits: [], truncated: false }
    const queryEmbedding = await this.embedding.embedQuery(request.query, signal)
    this.assertOpen()
    signal.throwIfAborted()
    const queryVector = singleVector(queryEmbedding)
    const rows = this.loadChunks(scope, request.knowledgeBaseIds)
    const keywordScores = this.keywordScores(scope, request.query)
    const totalWeight = this.options.keywordWeight + this.options.vectorWeight
    const scored = rows.flatMap((row) => {
      if (!compatible(row, queryEmbedding)) return []
      const vector = parseVector(row.vector, row.dimensions)
      if (vector === undefined) return []
      const vectorScore = Math.max(0, cosineSimilarity(vector, queryVector))
      const keywordScore = keywordScores.get(row.id) ?? 0
      const score = (
        this.options.vectorWeight * vectorScore
        + this.options.keywordWeight * keywordScore
      ) / totalWeight
      return [{ row, score }]
    }).sort((left, right) => right.score - left.score || left.row.id.localeCompare(right.row.id))

    return {
      hits: scored.slice(0, request.maxResults).map(({ row, score }) => ({
        knowledgeBaseId: row.kb_id as KnowledgeBaseId,
        documentId: row.document_id as KnowledgeDocumentId,
        revisionId: row.revision_id as KnowledgeRevisionId,
        chunkId: row.id as KnowledgeChunkId,
        title: row.title,
        location: {},
        excerpt: row.text,
        contentHash: row.content_hash,
        indexRevision: row.index_revision,
        score,
      })),
      truncated: scored.length > request.maxResults,
    }
  }

  /**
   * Delete only a document resolved through the complete supplied scope.
   * @param scope - Trusted tenant and subject scope.
   * @param documentId - Opaque document id resolved within the scope.
   * @param signal - Cancellation signal.
   * @returns Nothing after transactional deletion.
   */
  deleteDocument(
    scope: KnowledgeScope,
    documentId: KnowledgeDocumentId,
    signal: AbortSignal,
  ): Promise<void> {
    this.assertOpen()
    signal.throwIfAborted()
    const values = [scope.tenantId, scope.subjectId, documentId] as const
    const found = this.db.prepare(`
      SELECT id FROM documents
      WHERE tenant_id = ? AND subject_id = ? AND id = ?
    `).get(...values)
    if (found === undefined) return Promise.reject(notFound('document'))
    transaction(this.db, () => {
      this.db.prepare(`
        DELETE FROM chunks_fts WHERE chunk_id IN (
          SELECT id FROM chunks WHERE tenant_id = ? AND subject_id = ? AND document_id = ?
        )
      `).run(...values)
      this.db.prepare('DELETE FROM chunks WHERE tenant_id = ? AND subject_id = ? AND document_id = ?').run(...values)
      this.db.prepare('DELETE FROM revisions WHERE tenant_id = ? AND subject_id = ? AND document_id = ?').run(...values)
      this.db.prepare('DELETE FROM documents WHERE tenant_id = ? AND subject_id = ? AND id = ?').run(...values)
    })
    return Promise.resolve()
  }

  /**
   * Stop new work, cancel ingestion, wait for quiescence, and close SQLite.
   * @returns Shared teardown promise; concurrent callers observe the same close.
   */
  close(): Promise<void> {
    if (this.closePromise !== undefined) return this.closePromise
    this.state = 'closing'
    this.closeController.abort()
    this.closePromise = (async () => {
      await Promise.allSettled([...this.tasks])
      this.db.close()
      this.state = 'closed'
    })()
    return this.closePromise
  }

  private async process(
    scope: KnowledgeScope,
    input: KnowledgeDocumentInput,
    jobId: string,
    signal: AbortSignal,
  ): Promise<void> {
    this.setJob(scope, jobId, 'running')
    try {
      const bytes = await consume(input.content, signal)
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      const chunks = splitText(text, this.options.chunkChars, this.options.chunkOverlapChars)
      const embedded = await this.embedding.embedDocuments(chunks, signal)
      validateDocumentEmbedding(embedded, chunks.length)
      signal.throwIfAborted()
      this.assertOpen()
      this.publish(scope, input, jobId, text, chunks, embedded)
    } catch (error) {
      const cancelled = signal.aborted || this.state !== 'open'
      if (this.state !== 'closed') {
        this.setJob(scope, jobId, cancelled ? 'cancelled' : 'failed', ingestionMessage(error))
      }
    }
  }

  private publish(
    scope: KnowledgeScope,
    input: KnowledgeDocumentInput,
    jobId: string,
    text: string,
    chunks: readonly string[],
    embedded: EmbeddingResult,
  ): void {
    const documentId = randomUUID()
    const revisionId = randomUUID()
    const contentHash = createHash('sha256').update(text).digest('hex')
    const indexRevision = identityKey(embedded)
    transaction(this.db, () => {
      this.db.prepare('INSERT INTO documents VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
        documentId,
        scope.tenantId,
        scope.subjectId,
        input.knowledgeBaseId,
        input.title,
        input.contentType,
        contentHash,
        revisionId,
      )
      this.db.prepare('INSERT INTO revisions VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
        revisionId,
        scope.tenantId,
        scope.subjectId,
        documentId,
        indexRevision,
        embedded.identity.model,
        embedded.identity.revision,
        embedded.identity.dimensions,
      )
      const chunkStatement = this.db.prepare('INSERT INTO chunks VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      const ftsStatement = this.db.prepare('INSERT INTO chunks_fts VALUES (?, ?, ?, ?)')
      chunks.forEach((chunk, ordinal) => {
        const chunkId = randomUUID()
        const vector = embedded.vectors[ordinal]
        if (vector === undefined) throw invalidEmbedding()
        chunkStatement.run(
          chunkId,
          scope.tenantId,
          scope.subjectId,
          documentId,
          revisionId,
          ordinal,
          chunk,
          JSON.stringify(vector),
        )
        ftsStatement.run(chunk, scope.tenantId, scope.subjectId, chunkId)
      })
      this.db.prepare(`
        UPDATE jobs SET status = ?, document_id = ?, revision_id = ?, error = NULL
        WHERE id = ? AND tenant_id = ? AND subject_id = ?
      `).run('succeeded', documentId, revisionId, jobId, scope.tenantId, scope.subjectId)
    })
  }

  private setJob(
    scope: KnowledgeScope,
    jobId: string,
    status: KnowledgeIngestJob['status'],
    error?: string,
  ): void {
    this.db.prepare(`
      UPDATE jobs SET status = ?, error = ?
      WHERE id = ? AND tenant_id = ? AND subject_id = ?
    `).run(status, error ?? null, jobId, scope.tenantId, scope.subjectId)
  }

  private loadChunks(
    scope: KnowledgeScope,
    knowledgeBaseIds: readonly KnowledgeBaseId[] | undefined,
  ): ChunkRow[] {
    const ids = knowledgeBaseIds?.map(String)
    const filter = ids === undefined ? '' : `AND d.kb_id IN (${ids.map(() => '?').join(', ')})`
    return this.db.prepare(`
      SELECT c.id, c.document_id, c.revision_id, c.text, c.vector,
             d.kb_id, d.title, d.content_hash,
             r.index_revision, r.model, r.model_revision, r.dimensions
      FROM chunks c
      JOIN documents d
        ON d.id = c.document_id AND d.tenant_id = c.tenant_id AND d.subject_id = c.subject_id
      JOIN revisions r
        ON r.id = c.revision_id AND r.tenant_id = c.tenant_id AND r.subject_id = c.subject_id
      WHERE c.tenant_id = ? AND c.subject_id = ? ${filter}
    `).all(scope.tenantId, scope.subjectId, ...(ids ?? [])) as unknown as ChunkRow[]
  }

  private keywordScores(scope: KnowledgeScope, query: string): ReadonlyMap<string, number> {
    const match = ftsQuery(query)
    if (match === '') return new Map()
    const rows = this.db.prepare(`
      SELECT chunk_id, bm25(chunks_fts) AS rank
      FROM chunks_fts
      WHERE tenant_id = ? AND subject_id = ? AND chunks_fts MATCH ?
    `).all(scope.tenantId, scope.subjectId, match) as unknown as FtsRow[]
    return new Map(rows.map(row => [row.chunk_id, bm25Relevance(row.rank)]))
  }

  private assertOpen(): void {
    if (this.state !== 'open') throw new KnowledgeError('knowledge provider is closed', 'KNOWLEDGE_PROVIDER_CLOSED')
  }
}

function resolveOptions(options: SqliteKnowledgeOptions): ResolvedOptions {
  return {
    path: options.path ?? ':memory:',
    id: options.id ?? 'sqlite-local',
    chunkChars: options.chunkChars ?? 1200,
    chunkOverlapChars: options.chunkOverlapChars ?? 120,
    keywordWeight: options.keywordWeight ?? 0.35,
    vectorWeight: options.vectorWeight ?? 0.65,
  }
}

function validateOptions(options: ResolvedOptions): void {
  const validChunks = Number.isInteger(options.chunkChars)
    && options.chunkChars > 0
    && Number.isInteger(options.chunkOverlapChars)
    && options.chunkOverlapChars >= 0
    && options.chunkOverlapChars < options.chunkChars
  const validWeights = Number.isFinite(options.keywordWeight)
    && options.keywordWeight >= 0
    && Number.isFinite(options.vectorWeight)
    && options.vectorWeight >= 0
    && options.keywordWeight + options.vectorWeight > 0
  if (options.id.length === 0 || !validChunks || !validWeights) {
    throw new KnowledgeError('invalid sqlite knowledge configuration', 'KNOWLEDGE_INVALID_CONFIG')
  }
}

async function consume(content: AsyncIterable<Uint8Array>, signal: AbortSignal): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  for await (const chunk of content) {
    signal.throwIfAborted()
    chunks.push(new Uint8Array(chunk))
  }
  signal.throwIfAborted()
  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk)))
}

function splitText(text: string, size: number, overlap: number): string[] {
  const chunks: string[] = []
  for (let start = 0; start < text.length;) {
    chunks.push(text.slice(start, start + size))
    if (start + size >= text.length) break
    start += size - overlap
  }
  return chunks.length === 0 ? [''] : chunks
}

function validateDocumentEmbedding(result: EmbeddingResult, expected: number): void {
  if (result.vectors.length !== expected || result.identity.dimensions < 1) throw invalidEmbedding()
  const invalid = result.vectors.some(vector => (
    vector.length !== result.identity.dimensions || vector.some(value => !Number.isFinite(value))
  ))
  if (invalid) throw invalidEmbedding()
}

function singleVector(result: EmbeddingResult): readonly number[] {
  const vector = result.vectors[0]
  if (result.vectors.length !== 1 || vector === undefined || vector.length !== result.identity.dimensions) {
    throw invalidEmbedding()
  }
  return vector
}

function compatible(row: ChunkRow, query: EmbeddingResult): boolean {
  return row.index_revision === identityKey(query)
    && row.model === query.identity.model
    && row.model_revision === query.identity.revision
    && row.dimensions === query.identity.dimensions
}

function parseVector(value: string, dimensions: number): readonly number[] | undefined {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed) || parsed.length !== dimensions || parsed.some(item => typeof item !== 'number')) return undefined
    return parsed.map(item => item as number)
  } catch (error) {
    if (error instanceof SyntaxError) return undefined
    throw error
  }
}

function identityKey(result: EmbeddingResult): string {
  return `${result.identity.model}:${result.identity.revision}:${result.identity.dimensions}`
}

function ftsQuery(query: string): string {
  const tokens = query.match(/[\p{L}\p{N}_]+/gu) ?? []
  return tokens.map(token => `"${token.replaceAll('"', '')}"`).join(' OR ')
}

function ingestionMessage(error: unknown): string {
  if (error instanceof KnowledgeError) return error.message
  if (error instanceof TypeError) return 'invalid UTF-8 content'
  return 'ingestion failed'
}

function invalidEmbedding(): KnowledgeError {
  return new KnowledgeError('embedding result is incompatible with its identity', 'KNOWLEDGE_EMBEDDING_INVALID')
}

function notFound(subject: string): KnowledgeError {
  return new KnowledgeError(`${subject} not found`, 'KNOWLEDGE_NOT_FOUND')
}
