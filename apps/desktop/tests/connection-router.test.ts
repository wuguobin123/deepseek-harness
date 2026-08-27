import { describe, expect, it, vi } from 'vitest'
import { ConnectionRouter } from '../src/main/connection-router'

function client() {
  return {
    call: vi.fn(async (method: string) => method),
    respond: vi.fn(async () => undefined),
    streamMux: vi.fn(async function* (signal?: AbortSignal) {
      await new Promise<void>((resolve) => {
        signal?.addEventListener('abort', () => { resolve() }, { once: true })
      })
      yield* []
    }),
    streamHost: vi.fn(async function* () { yield* [] }),
  }
}

describe('ConnectionRouter', () => {
  it('routes account methods to cloud and aborts local streams on switch', async () => {
    const cloud = client()
    const local = client()
    const router = new ConnectionRouter(cloud as never, () => local as never)
    await router.call('workspace.list', {})
    await router.call('account.signin', {})
    expect(local.call).toHaveBeenCalledWith('workspace.list', {})
    expect(cloud.call).toHaveBeenCalledWith('account.signin', {})
    const stream = router.streamMux()
    const iterator = stream[Symbol.asyncIterator]()
    const pending = iterator.next()
    await router.setEnvironment('cloud')
    await pending
    await iterator.next()
    expect(local.streamMux).toHaveBeenCalled()
  })
})
