import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import * as MaxTokenContinuation from '@deepseek-ai/dsh-max-token-continuation'
import { MockAdapter, maxTokensResponse, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

async function harness(maxContinuations = 2): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(MaxTokenContinuation, { maxContinuations })
  return ctx
}

async function bareHarness(): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  return ctx
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject !== agent || status !== 'idle') return
      dispose()
      resolve()
    })
  })
}

function start(agent: Agent, text = 'finish the task'): void {
  agent.followup(createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }))
}

function turnReasons(agent: Agent): unknown[] {
  return agent.session.events
    .filter((event): event is SessionEvent<'turn/end'> => event.type === 'turn/end')
    .map(event => event.data.reason)
}

function continuationMessages(agent: Agent): SessionEvent<'user/message'>[] {
  return agent.session.events.filter((event): event is SessionEvent<'user/message'> =>
    event.type === 'user/message'
    && event.data.source.kind === 'plugin'
    && event.data.source.plugin === MaxTokenContinuation.name)
}

describe('max-token continuation', () => {
  it('automatically continues capped turns until a clean completion', async () => {
    const ctx = await harness(3)
    const adapter = new MockAdapter([
      maxTokensResponse('first partial'),
      maxTokensResponse('second partial'),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('automatic-continuation'), { provider: 'mock', model: 'mock' })

    start(agent)
    await waitForIdle(ctx, agent)

    expect(adapter.requests).toHaveLength(3)
    expect(turnReasons(agent)).toEqual([
      { kind: 'max-tokens' },
      { kind: 'max-tokens' },
      { kind: 'completed' },
    ])
    const contexts = continuationMessages(agent)
    expect(contexts).toHaveLength(2)
    expect(contexts.map(event => event.data.source)).toEqual([
      {
        kind: 'plugin',
        plugin: MaxTokenContinuation.name,
        form: 'notice',
        summary: 'Output limit reached; automatically continuing (1/3)',
        cause: 'max-tokens',
        fromTurn: 1,
        ordinal: 1,
        limit: 3,
      },
      {
        kind: 'plugin',
        plugin: MaxTokenContinuation.name,
        form: 'notice',
        summary: 'Output limit reached; automatically continuing (2/3)',
        cause: 'max-tokens',
        fromTurn: 2,
        ordinal: 2,
        limit: 3,
      },
    ])
    expect(contexts[0]?.data.content).toEqual([{ type: 'text', text: MaxTokenContinuation.CONTINUATION_PROMPT }])
  })

  it('stops at the configured cap and a later human prompt starts a fresh chain', async () => {
    const ctx = await harness(2)
    const adapter = new MockAdapter([
      maxTokensResponse('one'),
      maxTokensResponse('two'),
      maxTokensResponse('three'),
      textResponse('manual recovery'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('bounded-continuation'), { provider: 'mock', model: 'mock' })

    start(agent)
    await waitForIdle(ctx, agent)
    expect(adapter.requests).toHaveLength(3)
    expect(continuationMessages(agent)).toHaveLength(2)

    start(agent, 'continue manually')
    await waitForIdle(ctx, agent)
    expect(adapter.requests).toHaveLength(4)
    expect(turnReasons(agent).at(-1)).toEqual({ kind: 'completed' })
  })

  it('does not add work after a normally completed turn', async () => {
    const ctx = await harness()
    const adapter = new MockAdapter([textResponse('done')])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('normal-completion'), { provider: 'mock', model: 'mock' })

    start(agent)
    await waitForIdle(ctx, agent)

    expect(adapter.requests).toHaveLength(1)
    expect(continuationMessages(agent)).toHaveLength(0)
    expect(turnReasons(agent)).toEqual([{ kind: 'completed' }])
  })

  it('recovers one unclaimed continuation when a capped session resumes', async () => {
    const ctx = await bareHarness()
    const adapter = new MockAdapter([
      maxTokensResponse('partial before restart'),
      textResponse('finished after restart'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('resume-continuation'), { provider: 'mock', model: 'mock' })

    start(agent)
    await waitForIdle(ctx, agent)
    expect(adapter.requests).toHaveLength(1)

    await ctx.plugin(MaxTokenContinuation, { maxContinuations: 2 })
    const idle = waitForIdle(ctx, agent)
    agentEvents(ctx, agent).emit('agent/session-start', { source: 'resume' })
    agentEvents(ctx, agent).emit('agent/session-start', { source: 'resume' })
    await idle

    expect(adapter.requests).toHaveLength(2)
    expect(continuationMessages(agent)).toHaveLength(1)
    expect(turnReasons(agent).at(-1)).toEqual({ kind: 'completed' })
  })

  it('preserves a queued caller message instead of appending recovery behind it', async () => {
    const ctx = await bareHarness()
    const adapter = new MockAdapter([
      maxTokensResponse('partial before caller input'),
      textResponse('caller request handled'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('caller-priority'), { provider: 'mock', model: 'mock' })

    start(agent)
    await waitForIdle(ctx, agent)
    await ctx.plugin(MaxTokenContinuation, { maxContinuations: 2 })

    const idle = waitForIdle(ctx, agent)
    start(agent, 'new caller instruction')
    agentEvents(ctx, agent).emit('agent/session-start', { source: 'resume' })
    await idle

    expect(adapter.requests).toHaveLength(2)
    expect(continuationMessages(agent)).toHaveLength(0)
    expect(agent.session.events.some(event => event.type === 'user/message'
      && event.data.source.kind === 'user'
      && event.data.content[0]?.type === 'text'
      && event.data.content[0].text === 'new caller instruction')).toBe(true)
  })

  it('fails loud when called directly with an invalid cap', () => {
    const ctx = new Context()
    expect(() => { MaxTokenContinuation.apply(ctx, { maxContinuations: 0 }) }).toThrow(/positive integer/)
  })

  it.each([
    { fromTurn: 0, ordinal: 1, limit: 1 },
    { fromTurn: 1, ordinal: 0, limit: 1 },
    { fromTurn: 1, ordinal: 1, limit: 0 },
    { fromTurn: 1, ordinal: 2, limit: 1 },
  ])('rejects invalid durable continuation metadata %#', (metadata) => {
    expect(MaxTokenContinuation.isContinuationSource({
      kind: 'plugin', plugin: MaxTokenContinuation.name, form: 'notice',
      summary: 'x', cause: 'max-tokens', ...metadata,
    })).toBe(false)
  })
})
