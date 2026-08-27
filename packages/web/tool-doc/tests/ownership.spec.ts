import { describe, expect, it } from 'vitest'
import ToolRuntime, { type ToolRunContext } from '@deepseek-ai/dsh-tools'
import * as ToolDoc from '../src/index.ts'

function setup(): { tool: NonNullable<ReturnType<ToolRuntime['get']>>; writes: unknown[] } {
  const writes: unknown[] = []
  let tool: ReturnType<ToolRuntime['get']>
  const ctx = {
    artifactRegistry: {
      write: async (input: unknown) => {
        writes.push(input)
        return { artifactId: 'a', kind: 'doc', source: 'tool-doc', mediaType: 'text/markdown', bytes: 1, createdAt: 'now' }
      },
    },
    systemPrompt: { section: () => undefined },
    tools: { register: (definition: ReturnType<ToolRuntime['get']>) => { tool = definition } },
  } as never
  ToolDoc.apply(ctx, { maxBytes: 2048, defaultTitle: 'Document' })
  if (tool === undefined) throw new Error('doc_build was not registered')
  return { tool, writes }
}

const execution = (agent?: unknown): ToolRunContext => ({
  callId: 'call' as never, name: 'doc_build', arguments: {}, signal: new AbortController().signal, agent,
} as unknown as ToolRunContext)

describe('document artifact ownership and format', () => {
  it('writes Markdown bytes with the Agent session id', async () => {
    const { tool, writes } = setup()
    await tool.execute({
      title: '报告',
      format: 'markdown',
      sections: [{ heading: '结论', bodyMarkdown: '**完成**' }],
    }, execution({ session: { id: 'session-a' } }))

    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({ sessionId: 'session-a', mediaType: 'text/markdown' })
    expect(new TextDecoder().decode((writes[0] as { data: Uint8Array }).data)).toBe('# 报告\n\n## 结论\n\n**完成**\n')
  })

  it('rejects calls without an Agent before writing', async () => {
    const { tool, writes } = setup()
    await expect(tool.execute({ sections: [{ bodyMarkdown: 'x' }] }, execution())).rejects.toThrow('Agent session is required')
    expect(writes).toHaveLength(0)
  })
})
