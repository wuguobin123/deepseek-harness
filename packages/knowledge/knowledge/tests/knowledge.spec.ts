import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import KnowledgeRuntime, { KnowledgeError, type KnowledgeProvider, type KnowledgeScope } from '../src/index.ts'
import type { KnowledgeBaseId, KnowledgeDocumentId, KnowledgeIngestJobId } from '../src/types.ts'

const scope = { tenantId: 'tenant-a' as KnowledgeScope['tenantId'], subjectId: 'subject-a' as KnowledgeScope['subjectId'] }
const base = 'kb-1' as KnowledgeBaseId
const doc = 'doc-1' as KnowledgeDocumentId
const job = 'job-1' as KnowledgeIngestJobId

function provider(id: string, overrides: Partial<KnowledgeProvider> = {}): KnowledgeProvider {
  return {
    id,
    available: () => true,
    createKnowledgeBase: async () => ({ id: base, name: 'base' }),
    listKnowledgeBases: async () => [],
    startIngest: async () => ({ id: job, status: 'queued' }),
    getIngestJob: async () => ({ id: job, status: 'queued' }),
    search: async () => ({ hits: [], truncated: false }),
    deleteDocument: async () => {},
    ...overrides,
  }
}

async function mount(config: ConstructorParameters<typeof KnowledgeRuntime>[1] = {}) {
  const ctx = new Context()
  await ctx.plugin(KnowledgeRuntime, config)
  return { ctx, knowledge: ctx.knowledge }
}

describe('KnowledgeRuntime provider selection and lifecycle', () => {
  it('rejects duplicates and unregisters through disposer', async () => {
    const { knowledge } = await mount()
    const p = provider('one')
    const dispose = knowledge.registerProvider(p)
    expect(() => knowledge.registerProvider(p)).toThrow(expect.objectContaining({ code: 'KNOWLEDGE_DUPLICATE_PROVIDER' }))
    await expect(knowledge.listKnowledgeBases(scope, new AbortController().signal)).resolves.toEqual([])
    dispose()
    await expect(knowledge.listKnowledgeBases(scope, new AbortController().signal)).rejects.toThrow(expect.objectContaining({ code: 'KNOWLEDGE_PROVIDER_UNAVAILABLE' }))
  })

  it('disposes registrations with the contributing fiber (HMR)', async () => {
    const { ctx, knowledge } = await mount()
    const fiber = await ctx.plugin(Object.assign((inner: Context) => { inner.knowledge.registerProvider(provider('hmr')) }, { inject: ['knowledge'] }))
    await expect(knowledge.listKnowledgeBases(scope, new AbortController().signal)).resolves.toEqual([])
    await fiber.dispose()
    await expect(knowledge.listKnowledgeBases(scope, new AbortController().signal)).rejects.toThrow(expect.objectContaining({ code: 'KNOWLEDGE_PROVIDER_UNAVAILABLE' }))
  })

  it('rejects missing and ambiguous selection', async () => {
    const configured = await mount({ provider: 'missing' })
    await expect(configured.knowledge.listKnowledgeBases(scope, new AbortController().signal)).rejects.toThrow(expect.objectContaining({ code: 'KNOWLEDGE_PROVIDER_CONFIGURED_MISSING' }))
    const ambiguous = await mount()
    ambiguous.knowledge.registerProvider(provider('a'))
    ambiguous.knowledge.registerProvider(provider('b'))
    await expect(ambiguous.knowledge.listKnowledgeBases(scope, new AbortController().signal)).rejects.toThrow(expect.objectContaining({ code: 'KNOWLEDGE_PROVIDER_AMBIGUOUS' }))
  })
})

describe('KnowledgeRuntime scoped execution', () => {
  it('passes scope and signal unchanged and expresses provider-owned tenant isolation', async () => {
    const { knowledge } = await mount()
    let seenScope: KnowledgeScope | undefined
    let seenSignal: AbortSignal | undefined
    knowledge.registerProvider(provider('one', {
      search: async (receivedScope, _request, signal) => {
        seenScope = receivedScope
        seenSignal = signal
        return { hits: [], truncated: false }
      },
    }))
    const signal = new AbortController().signal
    await knowledge.search(scope, { knowledgeBaseIds: [base], query: 'q', maxResults: 2 }, signal)
    expect(seenScope).toBe(scope)
    expect(seenSignal).toBe(signal)
  })

  it('caps maxResults sent to and returned from an over-returning provider', async () => {
    const { knowledge } = await mount({ maxResults: 2 })
    knowledge.registerProvider(provider('one', { search: async (_scope, request) => ({
      hits: Array.from({ length: 4 }, (_, index) => ({
        knowledgeBaseId: request.knowledgeBaseIds?.[0] ?? base, documentId: doc, revisionId: 'r' as never, chunkId: `c-${index}` as never,
        title: 'title', location: { page: index + 1 }, excerpt: 'text', contentHash: 'hash', indexRevision: '1', score: 1,
      })), truncated: false,
    }) }))
    const result = await knowledge.search(scope, { knowledgeBaseIds: [base], query: 'q', maxResults: 9 }, new AbortController().signal)
    expect(result.hits).toHaveLength(2)
    expect(result.truncated).toBe(true)
  })

  it('rejects an empty search query before provider invocation', async () => {
    const { knowledge } = await mount()
    let called = false
    knowledge.registerProvider(provider('one', { search: async () => {
      called = true
      return { hits: [], truncated: false }
    } }))
    await expect(knowledge.search(scope, { query: '  ', maxResults: 1 }, new AbortController().signal)).rejects.toMatchObject({
      code: 'KNOWLEDGE_INVALID_REQUEST',
    })
    expect(called).toBe(false)
  })

  it('forwards abort to every operation', async () => {
    const { knowledge } = await mount()
    const signals: AbortSignal[] = []
    const record = (_scope: KnowledgeScope, signal: AbortSignal) => { signals.push(signal); return Promise.resolve([] as const) }
    knowledge.registerProvider(provider('one', {
      listKnowledgeBases: record,
      deleteDocument: async (_scope, _id, signal) => { signals.push(signal) },
    }))
    const signal = new AbortController().signal
    await knowledge.listKnowledgeBases(scope, signal)
    await knowledge.deleteDocument(scope, doc, signal)
    expect(signals).toEqual([signal, signal])
  })

  it('passes multiple knowledge-base ids unchanged and enforces streaming byte limits', async () => {
    const { knowledge } = await mount({ maxIngestBytes: 5 })
    let seenScope: KnowledgeScope | undefined
    let seenIds: readonly KnowledgeBaseId[] | undefined
    let seenBytes = 0
    knowledge.registerProvider(provider('one', {
      startIngest: async (receivedScope, input) => {
        seenScope = receivedScope
        seenBytes = 0
        for await (const chunk of input.content) seenBytes += chunk.byteLength
        return { id: job, status: 'queued' }
      },
      search: async (receivedScope, request) => {
        seenScope = receivedScope
        seenIds = request.knowledgeBaseIds
        return { hits: [], truncated: false }
      },
    }))
    const signal = new AbortController().signal
    const ids = [base, 'kb-2' as KnowledgeBaseId] as const
    await knowledge.search(scope, { knowledgeBaseIds: ids, query: 'q', maxResults: 1 }, signal)
    expect(seenScope).toBe(scope)
    expect(seenIds).toBe(ids)
    const chunks = (values: number[]) => (async function* () { for (const value of values) yield new Uint8Array(value) })()
    await knowledge.startIngest(scope, { knowledgeBaseId: base, title: 'x', contentType: 'text/plain', content: chunks([2, 3]) }, signal)
    expect(seenBytes).toBe(5)
    await expect(knowledge.startIngest(scope, { knowledgeBaseId: base, title: 'x', contentType: 'text/plain', content: chunks([2, 4]) }, signal)).rejects.toThrow(
      expect.objectContaining({ code: 'KNOWLEDGE_CONTENT_TOO_LARGE' }),
    )
    await expect(knowledge.startIngest(scope, { knowledgeBaseId: base, title: 'x', contentType: 'text/plain', byteLength: 6, content: chunks([1]) }, signal)).rejects.toThrow(
      expect.objectContaining({ code: 'KNOWLEDGE_CONTENT_TOO_LARGE' }),
    )
  })
})

it('exposes an open-string HarnessError code', () => {
  expect(new KnowledgeError('x', 'PROVIDER_CUSTOM').code).toBe('PROVIDER_CUSTOM')
})
