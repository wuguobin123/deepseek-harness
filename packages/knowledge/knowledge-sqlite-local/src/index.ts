/** Cordis assembly for the local SQLite knowledge provider. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { SqliteKnowledgeProvider, type SqliteKnowledgeOptions } from './provider.ts'

export { KNOWLEDGE_SQLITE_APPLICATION_ID, KNOWLEDGE_SQLITE_SCHEMA_VERSION } from './database.ts'
export { SqliteKnowledgeProvider, type SqliteKnowledgeOptions } from './provider.ts'
export { bm25Relevance, cosineSimilarity } from './ranking.ts'

/** Cordis plugin name. */
export const name = 'knowledge-sqlite-local'
/** Services required by the local provider. */
export const inject = ['knowledge', 'embedding']

/** Local SQLite storage, chunking, and fusion settings. */
export interface Config {
  /** SQLite database path; `:memory:` creates an ephemeral store. */
  readonly path?: string
  /** Stable provider id used for runtime selection. */
  readonly id?: string
  /** Maximum characters in each indexed chunk. */
  readonly chunkChars?: number
  /** Number of overlapping characters between adjacent chunks. */
  readonly chunkOverlapChars?: number
  /** Relative weight assigned to keyword relevance. */
  readonly keywordWeight?: number
  /** Relative weight assigned to vector similarity. */
  readonly vectorWeight?: number
}

/** Runtime configuration schema. */
export const Config: z<Config> = z.object({
  path: z.string().default(':memory:'),
  id: z.string().default('sqlite-local'),
  chunkChars: z.number().step(1).min(1).default(1200),
  chunkOverlapChars: z.number().step(1).min(0).default(120),
  keywordWeight: z.number().min(0).default(0.35),
  vectorWeight: z.number().min(0).default(0.65),
})

/** Register one provider and close its database during fiber teardown. */
export function apply(ctx: Context, config: Config = {}): () => void {
  const options: SqliteKnowledgeOptions = {
    path: config.path ?? ':memory:',
    id: config.id ?? 'sqlite-local',
    chunkChars: config.chunkChars ?? 1200,
    chunkOverlapChars: config.chunkOverlapChars ?? 120,
    keywordWeight: config.keywordWeight ?? 0.35,
    vectorWeight: config.vectorWeight ?? 0.65,
  }
  const provider = new SqliteKnowledgeProvider(options, ctx.embedding)
  const dispose = ctx.effect(function* () {
    const unregister = ctx.knowledge.registerProvider(provider)
    yield async () => {
      unregister()
      await provider.close()
    }
  }, 'knowledge-sqlite-local.register')
  return () => void dispose()
}
