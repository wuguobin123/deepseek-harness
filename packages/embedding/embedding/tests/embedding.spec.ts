import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import EmbeddingRuntime, { type EmbeddingProvider } from '../src/index.ts'

const provider = (id: string, available = true): EmbeddingProvider => ({
  id, available: () => available,
  embedDocuments: async (_documents, signal) => { signal?.throwIfAborted(); return { vectors: [[1]], identity: { model: id, revision: 'test', dimensions: 1 } } },
  embedQuery: async (_query, signal) => { signal?.throwIfAborted(); return { vectors: [[1]], identity: { model: id, revision: 'test', dimensions: 1 } } },
})

async function mount(config: ConstructorParameters<typeof EmbeddingRuntime>[1] = {}): Promise<EmbeddingRuntime> {
  const ctx = new Context()
  await ctx.plugin(EmbeddingRuntime, config)
  return ctx.embedding
}

describe('EmbeddingRuntime', () => {
  it('selects explicitly and rejects ambiguity', async () => {
    const embedding = await mount({ provider: 'b' })
    embedding.registerProvider(provider('a'))
    embedding.registerProvider(provider('b'))
    await expect(embedding.embedQuery('q')).resolves.toMatchObject({ identity: { model: 'b' } })
    const automatic = await mount()
    automatic.registerProvider(provider('a'))
    automatic.registerProvider(provider('b'))
    await expect(automatic.embedQuery('q')).rejects.toMatchObject({ code: 'EMBEDDING_AMBIGUOUS' })
  })

  it('reports duplicate, configured missing/unavailable, and selects the only usable provider', async () => {
    const embedding = await mount()
    embedding.registerProvider(provider('offline'))
    expect(() => embedding.registerProvider(provider('offline'))).toThrow(expect.objectContaining({ code: 'EMBEDDING_DUPLICATE_PROVIDER' }))
    await expect(embedding.embedQuery('q')).resolves.toMatchObject({ identity: { model: 'offline' } })
    const missing = await mount({ provider: 'missing' })
    await expect(missing.embedQuery('q')).rejects.toMatchObject({ code: 'EMBEDDING_CONFIGURED_MISSING' })
    const unavailable = await mount({ provider: 'offline' })
    unavailable.registerProvider(provider('offline', false))
    await expect(unavailable.embedQuery('q')).rejects.toMatchObject({ code: 'EMBEDDING_CONFIGURED_UNAVAILABLE' })
  })

  it('passes the exact AbortSignal to the selected provider', async () => {
    const embedding = await mount()
    let seen: AbortSignal | undefined
    embedding.registerProvider({ ...provider('signal'), embedQuery: async (_query, signal) => {
      seen = signal
      return { vectors: [[1]], identity: { model: 'signal', revision: 'test', dimensions: 1 } }
    } })
    const controller = new AbortController()
    await embedding.embedQuery('q', controller.signal)
    expect(seen).toBe(controller.signal)
  })

  it('disposes registrations on fiber teardown and forwards cancellation', async () => {
    const ctx = new Context()
    await ctx.plugin(EmbeddingRuntime)
    const fiber = await ctx.plugin(Object.assign((inner: Context) => {
      inner.embedding.registerProvider(provider('a'))
    }, { inject: ['embedding'] }))
    const controller = new AbortController()
    controller.abort()
    await expect(ctx.embedding.embedDocuments(['x'], controller.signal)).rejects.toThrow()
    await fiber.dispose()
    await expect(ctx.embedding.embedQuery('q')).rejects.toMatchObject({ code: 'EMBEDDING_UNAVAILABLE' })
  })
})
