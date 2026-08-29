import { Context } from '@deepseek-ai/cordis'
import ApiProxyService from '../src/index.ts'
import { RpcId, type RpcRequest } from '../src/api/rpc.ts'
import WebRuntime from '@deepseek-ai/dsh-web'
import { describe, expect, it } from 'vitest'

/** The gateway's injected dependencies are not used by this focused route test. */
function provideGatewayDependencies(ctx: Context): void {
  for (const key of [
    'agentDefaultModel', 'agents', 'attachments', 'directoryPicker', 'llm', 'sessions', 'subagents', 'sessionQuery',
    'tools', 'userQuestions', 'workspaceRegistry',
  ]) ctx.provide(key, key === 'userQuestions' ? { registerProvider: () => () => {} } as never : {} as never)
}

describe('ApiProxy account web routing', () => {
  it('uses ctx.web from the service fiber injection', async () => {
    const ctx = new Context()
    await ctx.plugin(WebRuntime)
    ctx.web.registerSearchProvider({
      id: 'test',
      available: () => true,
      search: async request => ({
        content: request.query,
        sources: [{ url: 'https://example.test' }],
        truncated: false,
      }),
    })
    provideGatewayDependencies(ctx)
    await ctx.plugin(ApiProxyService)

    const request: RpcRequest<{ query: string; maxResults?: number }> = {
      rpcId: RpcId('account-web-test'),
      principal: { kind: 'account', userId: 'user-a' },
      payload: { query: 'injected' },
    }
    await expect(ctx.apiProxy.accountWeb.search(request)).resolves.toEqual({
      rpcId: request.rpcId,
      result: {
        ok: true,
        value: { content: 'injected', sources: [{ url: 'https://example.test' }], truncated: false },
      },
    })
    await ctx.fiber.dispose()
  })
})
