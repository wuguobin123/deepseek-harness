import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import EmbeddingRuntime, { type EmbeddingResult } from '@deepseek-ai/dsh-embedding'
import * as HashLocal from '@deepseek-ai/dsh-embedding-hash-local'
import KnowledgeRuntime, {
  type KnowledgeDocumentId,
  type KnowledgeIngestJob,
  type KnowledgeScope,
} from '@deepseek-ai/dsh-knowledge'
import * as SqliteLocal from '@deepseek-ai/dsh-knowledge-sqlite-local'
import {
  KNOWLEDGE_SQLITE_APPLICATION_ID,
  KNOWLEDGE_SQLITE_SCHEMA_VERSION,
  SqliteKnowledgeProvider,
  bm25Relevance,
  cosineSimilarity,
  type SqliteKnowledgeOptions,
} from '@deepseek-ai/dsh-knowledge-sqlite-local'
import { describe, expect, it } from 'vitest'

const signal = new AbortController().signal
const scope = scoped('tenant-a', 'subject-a')
const foreignTenant = scoped('tenant-b', 'subject-a')
const foreignSubject = scoped('tenant-a', 'subject-b')

const embedding = {
  embedDocuments: (texts: readonly string[]): Promise<EmbeddingResult> => Promise.resolve({
    vectors: texts.map(text => [text.includes('vector') ? 1 : 0, 1]),
    identity: { model: 'test', revision: '1', dimensions: 2 },
  }),
  embedQuery: (text: string): Promise<EmbeddingResult> => Promise.resolve({
    vectors: [[text.includes('vector') ? 1 : 0, 1]],
    identity: { model: 'test', revision: '1', dimensions: 2 },
  }),
}

describe('sqlite local knowledge provider', () => {
  it('assembles real runtimes and disposes through the contributing fiber', async () => {
    expect('default' in SqliteLocal).toBe(false)
    const loader = Object.create(Loader.prototype) as Loader
    expect(loader.unwrapExports(SqliteLocal)).toBe(SqliteLocal)
    const ctx = new Context()
    await ctx.plugin(EmbeddingRuntime)
    await ctx.plugin(KnowledgeRuntime, { provider: 'sqlite-local' })
    await ctx.plugin(HashLocal, { dimensions: 4 })
    const fiber = await ctx.plugin(SqliteLocal, { path: ':memory:' })
    await expect(ctx.knowledge.listKnowledgeBases(scope, signal)).resolves.toEqual([])
    await fiber.dispose()
    await expect(ctx.knowledge.listKnowledgeBases(scope, signal)).rejects.toMatchObject({
      code: 'KNOWLEDGE_PROVIDER_CONFIGURED_MISSING',
    })
  })

  it('ingests asynchronously and returns stable hybrid-search citations', async () => {
    const provider = createProvider({ chunkChars: 12, chunkOverlapChars: 2 })
    const base = await provider.createKnowledgeBase(scope, { name: 'docs' }, signal)
    const job = await provider.startIngest(scope, {
      knowledgeBaseId: base.id,
      title: 'Guide',
      contentType: 'text/markdown',
      content: content('# hello vector world'),
    }, signal)
    expect(job.status).toBe('queued')
    const completed = await waitForJob(provider, scope, job)
    expect(completed).toMatchObject({ status: 'succeeded' })

    const result = await provider.search(scope, { query: 'hello vector', maxResults: 5 }, signal)
    expect(result.hits.length).toBeGreaterThan(0)
    expect(result.hits[0]).toMatchObject({
      knowledgeBaseId: base.id,
      documentId: completed.documentId,
      revisionId: completed.revisionId,
      title: 'Guide',
      location: {},
    })
    expect(result.hits[0]?.contentHash).toMatch(/^[a-f0-9]{64}$/)
    expect(result.hits[0]?.indexRevision).toBe('test:1:2')
    await provider.close()
  })

  it('applies both tenant and subject to list, job, search, and delete', async () => {
    const provider = createProvider()
    const base = await provider.createKnowledgeBase(scope, { name: 'private' }, signal)
    const job = await provider.startIngest(scope, {
      knowledgeBaseId: base.id,
      title: 'Secret',
      contentType: 'text/plain',
      content: content('tenant secret vector'),
    }, signal)
    const completed = await waitForJob(provider, scope, job)
    const documentId = completed.documentId as KnowledgeDocumentId

    await expect(provider.listKnowledgeBases(foreignTenant, signal)).resolves.toEqual([])
    await expect(provider.listKnowledgeBases(foreignSubject, signal)).resolves.toEqual([])
    await expect(provider.getIngestJob(foreignTenant, job.id, signal)).rejects.toMatchObject({ code: 'KNOWLEDGE_NOT_FOUND' })
    await expect(provider.search(foreignSubject, { query: 'secret', maxResults: 5 }, signal)).resolves.toEqual({
      hits: [],
      truncated: false,
    })
    await expect(provider.deleteDocument(foreignTenant, documentId, signal)).rejects.toMatchObject({
      code: 'KNOWLEDGE_NOT_FOUND',
    })
    await provider.deleteDocument(scope, documentId, signal)
    await expect(provider.search(scope, { query: 'secret', maxResults: 5 }, signal)).resolves.toEqual({
      hits: [],
      truncated: false,
    })
    await provider.close()
  })

  it('treats an explicit empty base selection as no search space', async () => {
    let queryCalls = 0
    const provider = createProvider({}, {
      ...embedding,
      embedQuery: (query: string) => {
        queryCalls += 1
        return embedding.embedQuery(query)
      },
    })
    await expect(provider.search(scope, { query: 'anything', knowledgeBaseIds: [], maxResults: 5 }, signal)).resolves.toEqual({
      hits: [],
      truncated: false,
    })
    expect(queryCalls).toBe(0)
    await provider.close()
  })

  it('excludes vectors after an embedding identity change', async () => {
    let revision = '1'
    const changingEmbedding = {
      embedDocuments: (texts: readonly string[]): Promise<EmbeddingResult> => Promise.resolve({
        vectors: texts.map(() => [1, 0]),
        identity: { model: 'test', revision, dimensions: 2 },
      }),
      embedQuery: (): Promise<EmbeddingResult> => Promise.resolve({
        vectors: [[1, 0]],
        identity: { model: 'test', revision, dimensions: 2 },
      }),
    }
    const provider = createProvider({ keywordWeight: 0, vectorWeight: 1 }, changingEmbedding)
    const base = await provider.createKnowledgeBase(scope, { name: 'docs' }, signal)
    const job = await provider.startIngest(scope, {
      knowledgeBaseId: base.id,
      title: 'Vector',
      contentType: 'text/plain',
      content: content('vector only'),
    }, signal)
    await waitForJob(provider, scope, job)
    revision = '2'
    await expect(provider.search(scope, { query: 'vector', maxResults: 5 }, signal)).resolves.toEqual({
      hits: [],
      truncated: false,
    })
    await provider.close()
  })

  it('records malformed UTF-8 and cancellation as terminal job states', async () => {
    const provider = createProvider()
    const base = await provider.createKnowledgeBase(scope, { name: 'docs' }, signal)
    const malformed = await provider.startIngest(scope, {
      knowledgeBaseId: base.id,
      title: 'Bad',
      contentType: 'text/plain',
      content: bytes(new Uint8Array([0xff])),
    }, signal)
    await expect(waitForJob(provider, scope, malformed)).resolves.toMatchObject({ status: 'failed' })

    const controller = new AbortController()
    let release = (): void => {}
    const released = new Promise<void>((resolve) => { release = resolve })
    const cancelled = await provider.startIngest(scope, {
      knowledgeBaseId: base.id,
      title: 'Cancelled',
      contentType: 'text/plain',
      content: (async function* () {
        await released
        yield new TextEncoder().encode('late')
      })(),
    }, controller.signal)
    controller.abort()
    release()
    await expect(waitForJob(provider, scope, cancelled)).resolves.toMatchObject({ status: 'cancelled' })
    await provider.close()
  })

  it('stamps its database format and rejects operations after close', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-knowledge-'))
    const path = join(directory, 'knowledge.db')
    try {
      const provider = createProvider({ path })
      await provider.close()
      expect(() => provider.listKnowledgeBases(scope, signal)).toThrow(expect.objectContaining({
        code: 'KNOWLEDGE_PROVIDER_CLOSED',
      }))
      const db = new DatabaseSync(path, { readOnly: true })
      expect(db.prepare('PRAGMA application_id').get()).toEqual({ application_id: KNOWLEDGE_SQLITE_APPLICATION_ID })
      expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: KNOWLEDGE_SQLITE_SCHEMA_VERSION })
      db.close()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('rejects an unstamped database that already belongs to another application', () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-knowledge-foreign-'))
    const path = join(directory, 'foreign.db')
    try {
      const db = new DatabaseSync(path)
      db.exec('CREATE TABLE foreign_records(id TEXT PRIMARY KEY) STRICT')
      db.close()
      expect(() => createProvider({ path })).toThrow(expect.objectContaining({
        code: 'KNOWLEDGE_SCHEMA_INCOMPATIBLE',
      }))
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('uses bounded reciprocal bm25 relevance and true cosine similarity', () => {
    expect(bm25Relevance(-0.1)).toBeGreaterThan(bm25Relevance(-10))
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1)
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0)
    expect(cosineSimilarity([1], [1, 0])).toBe(0)
  })
})

function createProvider(
  options: SqliteKnowledgeOptions = {},
  embeddingClient: typeof embedding = embedding,
): SqliteKnowledgeProvider {
  return new SqliteKnowledgeProvider({ path: ':memory:', ...options }, embeddingClient)
}

function scoped(tenantId: string, subjectId: string): KnowledgeScope {
  return { tenantId: tenantId as KnowledgeScope['tenantId'], subjectId: subjectId as KnowledgeScope['subjectId'] }
}

function content(text: string): AsyncIterable<Uint8Array> { return bytes(new TextEncoder().encode(text)) }

async function* bytes(value: Uint8Array): AsyncIterable<Uint8Array> { yield value }

async function waitForJob(
  provider: SqliteKnowledgeProvider,
  jobScope: KnowledgeScope,
  job: KnowledgeIngestJob,
): Promise<KnowledgeIngestJob> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const current = await provider.getIngestJob(jobScope, job.id, signal)
    if (current.status !== 'queued' && current.status !== 'running') return current
    await new Promise(resolve => setTimeout(resolve, 1))
  }
  throw new Error('ingestion job did not settle')
}
