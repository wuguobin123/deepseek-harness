import { describe, expect, it } from 'vitest'
import { HashEmbeddingProvider } from '../src/index.ts'
import * as hashLocal from '../src/index.ts'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { Context } from '@deepseek-ai/cordis'
import EmbeddingRuntime from '../../embedding/src/index.ts'

describe('HashEmbeddingProvider', () => {
  it('rejects empty ids and invalid dimensions', () => {
    expect(() => new HashEmbeddingProvider({ id: '' })).toThrow()
    expect(() => new HashEmbeddingProvider({ dimensions: 0 })).toThrow()
    expect(() => new HashEmbeddingProvider({ dimensions: 1.5 })).toThrow()
  })

  it('keeps the namespace plugin intact through the real Loader unwrap path and disposes', async () => {
    expect('default' in hashLocal).toBe(false)
    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(hashLocal) as Record<string, unknown>
    expect(unwrapped).toBe(hashLocal)
    expect(unwrapped.name).toBe('embedding-hash-local')
    expect(unwrapped.inject).toEqual(['embedding'])
    expect(typeof unwrapped.apply).toBe('function')
    const ctx = new Context()
    await ctx.plugin(EmbeddingRuntime)
    const fiber = await ctx.plugin(hashLocal, { dimensions: 4 })
    await expect(ctx.embedding.embedQuery('q')).resolves.toMatchObject({ identity: { dimensions: 4 } })
    await fiber.dispose()
    await expect(ctx.embedding.embedQuery('q')).rejects.toMatchObject({ code: 'EMBEDDING_UNAVAILABLE' })
  })

  it('is deterministic, normalized, and preserves dimensions for batches', async () => {
    const provider = new HashEmbeddingProvider({ dimensions: 8 })
    const first = await provider.embedDocuments(['alpha', 'beta'])
    const second = await provider.embedDocuments(['alpha', 'beta'])
    expect(first).toEqual(second)
    expect(first.vectors).toHaveLength(2)
    expect(first.vectors[0]).toHaveLength(8)
    expect(Math.hypot(...first.vectors[0]!)).toBeCloseTo(1)
    expect(first.identity).toEqual({ model: 'hash-local', revision: 'feature-hash-v1', dimensions: 8 })
  })

  it('honors abort signals', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(new HashEmbeddingProvider().embedQuery('q', controller.signal)).rejects.toThrow()
  })
})
