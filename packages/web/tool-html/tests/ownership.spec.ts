import { describe, expect, it } from 'vitest'
import ToolRuntime, { type ToolRunContext } from '@deepseek-ai/dsh-tools'
import * as ToolHtml from '../src/index.ts'

function setup(): { tool: NonNullable<ReturnType<ToolRuntime['get']>>; writes: unknown[] } {
  const writes: unknown[] = []
  let tool: ReturnType<ToolRuntime['get']>
  const ctx = { artifactRegistry: { write: async (input: unknown) => { writes.push(input); return { artifactId: 'a', kind: 'html', source: 'tool-html', mediaType: 'text/html', bytes: 1, createdAt: 'now' } } }, systemPrompt: { section: () => undefined }, tools: { register: (definition: ReturnType<ToolRuntime['get']>) => { tool = definition } } } as never
  ToolHtml.apply(ctx, { maxBytes: 2048, defaultTitle: 'HTML page' })
  if (tool === undefined) throw new Error('html_build was not registered')
  return { tool, writes }
}

const execution = (agent?: unknown): ToolRunContext => ({
  callId: 'call' as never, name: 'html_build', arguments: {}, signal: new AbortController().signal, agent,
} as unknown as ToolRunContext)

describe('html artifact ownership', () => {
  it('writes the Agent session id', async () => {
    const { tool, writes } = setup()
    await tool.execute({ html: '<p>ok</p>' }, execution({ session: { id: 'session-a' } }))
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({ sessionId: 'session-a' })
  })

  it('rejects calls without an Agent before writing', async () => {
    const { tool, writes } = setup()
    await expect(tool.execute({ html: '<p>ok</p>' }, execution())).rejects.toThrow('Agent session is required')
    expect(writes).toHaveLength(0)
  })
})
