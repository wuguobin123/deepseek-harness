import { describe, expect, it } from 'vitest'
import ToolRuntime, { type ToolRunContext } from '@deepseek-ai/dsh-tools'
import * as ToolChart from '../src/index.ts'

function setup(): { tool: NonNullable<ReturnType<ToolRuntime['get']>>; writes: unknown[] } {
  const writes: unknown[] = []
  let tool: ReturnType<ToolRuntime['get']>
  const ctx = { artifactRegistry: { write: async (input: unknown) => { writes.push(input); return { artifactId: 'a', kind: 'chart', source: 'tool-mermaid', mediaType: 'text/html', bytes: 1, createdAt: 'now' } } }, systemPrompt: { section: () => undefined }, tools: { register: (definition: ReturnType<ToolRuntime['get']>) => { if (definition?.name === 'mermaid_build') tool = definition } } } as never
  ToolChart.apply(ctx, { defaultTitle: 'Chart' })
  if (tool === undefined) throw new Error('mermaid_build was not registered')
  return { tool, writes }
}

const execution = (agent?: unknown): ToolRunContext => ({
  callId: 'call' as never, name: 'mermaid_build', arguments: {}, signal: new AbortController().signal, agent,
} as unknown as ToolRunContext)

describe('chart artifact ownership', () => {
  it('writes the Agent session id', async () => {
    const { tool, writes } = setup()
    await tool.execute({ source: 'flowchart TD\n A-->B' }, execution({ session: { id: 'session-c' } }))
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({ sessionId: 'session-c' })
  })

  it('rejects calls without an Agent before writing', async () => {
    const { tool, writes } = setup()
    await expect(tool.execute({ source: 'flowchart TD\n A-->B' }, execution())).rejects.toThrow('Agent session is required')
    expect(writes).toHaveLength(0)
  })
})
