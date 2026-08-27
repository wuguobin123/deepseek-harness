import { describe, expect, it } from 'vitest'
import { apiProxyRpcMethods, assertApiProxyRoutePartition } from '../src/index.ts'

describe('cloud route ownership', () => {
  it('accepts the current core/account union without overlap', async () => {
    const { ACCOUNT_RPC_METHODS, isAccountRpcMethod } = await import('@deepseek-ai/dsh-account-api-provider')
    const all = apiProxyRpcMethods()
    const core = all.filter(method => !isAccountRpcMethod(method))
    await expect(assertApiProxyRoutePartition(core)).resolves.toBeUndefined()
    expect(all.filter(isAccountRpcMethod)).toEqual([...ACCOUNT_RPC_METHODS])
  })
})
