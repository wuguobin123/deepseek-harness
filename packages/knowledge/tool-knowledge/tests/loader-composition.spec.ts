import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import KnowledgeRuntime, { type KnowledgeProvider } from '@deepseek-ai/dsh-knowledge'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as ToolKnowledge from '@deepseek-ai/dsh-tool-knowledge'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'

let directory: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (directory !== undefined) await rm(directory, { recursive: true, force: true })
  directory = undefined
})

const provider: KnowledgeProvider = {
  id: 'loader-test',
  available: () => true,
  createKnowledgeBase: () => Promise.reject(new Error('unused')),
  listKnowledgeBases: () => Promise.resolve([]),
  startIngest: () => Promise.reject(new Error('unused')),
  getIngestJob: () => Promise.reject(new Error('unused')),
  deleteDocument: () => Promise.resolve(),
  search: (_scope, request) => Promise.resolve({
    hits: [{
      knowledgeBaseId: 'kb-loader' as never,
      documentId: 'doc-loader' as never,
      revisionId: 'rev-loader' as never,
      chunkId: 'chunk-loader' as never,
      title: 'Loader policy',
      location: { section: 'Composition' },
      excerpt: `Evidence for ${request.query}`,
      contentHash: 'hash-loader',
      indexRevision: 'loader:1:2',
      score: 1,
    }],
    truncated: false,
  }),
}

const TestProvider = Object.assign(function testKnowledgeProvider(ctx: Context) {
  ctx.knowledge.registerProvider(provider)
}, { inject: ['knowledge'] })

describe('tool-knowledge real Loader composition', () => {
  it('boots cordis.yml and exposes scoped cited search', async () => {
    directory = await mkdtemp(join(tmpdir(), 'dsh-tool-knowledge-loader-'))
    const configPath = join(directory, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-system-prompt'",
      "- name: '@deepseek-ai/dsh-tools'",
      "- name: '@deepseek-ai/dsh-knowledge'",
      "- name: 'test-knowledge-provider'",
      "- name: '@deepseek-ai/dsh-tool-knowledge'",
      '',
    ].join('\n'))

    context = new Context()
    context.baseUrl = pathToFileURL(directory).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
      ['@deepseek-ai/dsh-tools', ToolRuntime],
      ['@deepseek-ai/dsh-knowledge', KnowledgeRuntime],
      ['test-knowledge-provider', TestProvider],
      ['@deepseek-ai/dsh-tool-knowledge', ToolKnowledge],
    ])
    context.loader.internal = {
      version: 'v2',
      import: (specifier: string) => Promise.resolve(modules.get(specifier)),
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await context.loader.await()

    expect(context.tools.schemas().map(schema => schema.name)).toContain('knowledge_search')
    const result = await context.tools.execute({
      name: 'knowledge_search',
      arguments: { query: 'retention' },
      callId: 'loader-call' as never,
      signal: new AbortController().signal,
      agent: { session: { header: { ownerId: 'owner-loader' } } } as never,
    })
    expect(result.isError).toBe(false)
    expect(result.content[0]).toMatchObject({ type: 'text' })
    expect((result.content[0] as { text: string }).text).toContain('[K1]')
  })
})
