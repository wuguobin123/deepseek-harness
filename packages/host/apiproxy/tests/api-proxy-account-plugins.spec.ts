import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent, type AgentHandle, type CreateAgentOptions } from '@deepseek-ai/dsh-agent'
import LocalAccountPluginFactory from '@deepseek-ai/dsh-account-plugin-factory'
import { createApiProxy } from '@deepseek-ai/dsh-host-apiproxy'
import type { RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionTitleService from '@deepseek-ai/dsh-session-title'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { describe, expect, it } from 'vitest'

function request<P>(payload: P, userId?: string): RpcRequest<P> {
  return {
    rpcId: RpcId(`account-plugins-${userId ?? 'anonymous'}`),
    payload,
    ...userId === undefined ? {} : { principal: { kind: 'account' as const, userId } },
  }
}

describe('account plugin API', () => {
  it('derives install ownership from the principal and never exposes composition paths', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(UserQuestionService)
    await ctx.plugin(SessionTitleService, { fallbackMaxWords: 5, fallbackMaxBytes: 80, maxTitleBytes: 80 })
    await ctx.plugin(LocalAccountPluginFactory, {
      path: ':memory:',
      catalog: [{
        pluginId: 'optional', title: 'Optional', description: 'Opt in', version: '1',
        systemDefault: false, activationId: 'optional',
      }],
      activators: { optional: () => {} },
    })
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'p', model: 'm' }),
      cwd: '/tmp',
    })

    expect((await api.accountPlugins.list(request({}))).result).toMatchObject({
      ok: false, error: { code: 'unauthenticated' },
    })
    const installed = await api.accountPlugins.install(request({ pluginId: 'optional' }, 'user-a'))
    expect(installed.result).toMatchObject({ ok: true, value: { pluginId: 'optional', installed: true } })
    expect(JSON.stringify(installed)).not.toContain('activationId')
    expect(JSON.stringify(installed)).not.toContain('/server/private')

    const listA = await api.accountPlugins.list(request({}, 'user-a'))
    const listB = await api.accountPlugins.list(request({}, 'user-b'))
    expect(listA.result.ok && listA.result.value.items[0]?.installed).toBe(true)
    expect(listB.result.ok && listB.result.value.items[0]?.installed).toBe(false)
    await ctx.fiber.dispose()
  })

  it('records one selection for new sessions and preserves it through forks', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(UserQuestionService)
    ctx.provide('workspaceRegistry', { list: () => [] } as never)
    ctx.agents.setFactory({
      createAgent: async (ownerCtx: Context, options: CreateAgentOptions): Promise<AgentHandle> => {
        const session = ctx.sessions.create(options.sessionId, {
          ...options.seed === undefined ? {} : { seed: [...options.seed] },
          ...options.meta === undefined ? {} : { meta: options.meta },
        })
        const agent = {} as Agent
        const agentCtx = ownerCtx.extend({ agent })
        Object.assign(agent, { id: session.id, session, status: 'idle', ctx: agentCtx })
        await options.setup?.(agentCtx)
        const unregister = ctx.agents.register(agent)
        return { agent, dispose: async () => { unregister() } }
      },
      resume: () => Promise.reject(new Error('this fixture restores through fork seeds')),
    })
    const activations: { name: string; ctx: Context }[] = []
    const fixtureActivator = (name: string) => (inner: Context) => { activations.push({ name, ctx: inner }) }
    await ctx.plugin(LocalAccountPluginFactory, {
      path: ':memory:',
      catalog: [
        {
          pluginId: 'default', title: 'Default', description: 'Built in', version: '1',
          systemDefault: true, activationId: 'default',
        },
        {
          pluginId: 'optional', title: 'Optional', description: 'Opt in', version: '1',
          systemDefault: false, activationId: 'optional',
        },
      ],
      activators: { default: fixtureActivator('default_tool'), optional: fixtureActivator('optional_tool') },
    })
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'p', model: 'm' }),
      cwd: '/tmp',
    })
    await api.accountPlugins.install(request({ pluginId: 'optional' }, 'user-a'))
    const created = await api.sessions.create(request({ cwd: '/tmp' }, 'user-a'))
    if (!created.result.ok) throw new Error(`source session was not created: ${JSON.stringify(created.result.error)}`)
    const sourceId = SessionId(created.result.value.sessionId)
    const source = ctx.agents.get(sourceId)
    expect(source).toBeDefined()
    if (source === undefined) throw new Error('source agent was not created')
    expect(activations.filter(item => item.ctx === source.ctx).map(item => item.name).sort())
      .toEqual(['default_tool', 'optional_tool'])
    expect(source.session.events[0]).toMatchObject({
      type: 'account-plugins/selected', data: { pluginIds: ['optional'] },
    })
    source.session.append('turn/start', { turn: 1 })
    source.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    await api.accountPlugins.uninstall(request({ pluginId: 'optional' }, 'user-a'))
    const forked = await api.sessions.fork(request({ sessionId: sourceId }, 'user-a'))
    if (!forked.result.ok) throw new Error(`source session was not forked: ${JSON.stringify(forked.result.error)}`)
    const child = ctx.agents.get(forked.result.value.sessionId)
    expect(child).toBeDefined()
    if (child === undefined) throw new Error('fork agent was not created')
    expect(activations.filter(item => item.ctx === child.ctx).map(item => item.name).sort())
      .toEqual(['default_tool', 'optional_tool'])
    expect(child.session.events[0]).toMatchObject({
      type: 'account-plugins/selected', data: { pluginIds: ['optional'] },
    })

    const later = await api.sessions.create(request({ cwd: '/tmp' }, 'user-a'))
    expect(later.result.ok).toBe(true)
    if (!later.result.ok) throw new Error('later session was not created')
    const laterId = SessionId(later.result.value.sessionId)
    const laterAgent = ctx.agents.get(laterId)
    expect(laterAgent).toBeDefined()
    if (laterAgent === undefined) throw new Error('later agent was not created')
    expect(activations.filter(item => item.ctx === laterAgent.ctx).map(item => item.name)).toEqual(['default_tool'])
    expect(laterAgent.session.events[0]).toMatchObject({
      type: 'account-plugins/selected', data: { pluginIds: [] },
    })
    await ctx.fiber.dispose()
  })
})
