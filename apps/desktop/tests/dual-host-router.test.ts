import { describe, expect, it, vi } from 'vitest'
import { DualHostRouter } from '../src/main/dual-host-router'
import { decodeResourceId, encodeResourceId } from '../src/main/resource-codec'

function client(options: { calls?: Record<string, unknown>; mux?: unknown[] } = {}) {
  return {
    call: vi.fn(async (method: string) => {
      const value = options.calls?.[method]
      if (value instanceof Error) throw value
      return value ?? { source: method }
    }),
    respond: vi.fn(async () => undefined),
    streamMux: vi.fn(async function* () {
      for (const frame of options.mux ?? []) yield frame
    }),
    streamHost: vi.fn(async function* () { yield* [] }),
  }
}

describe('federated desktop resource ids', () => {
  it('round-trips opaque ids containing colons', () => {
    const encoded = encodeResourceId('local', 'sha256:a:b')
    expect(encoded).toMatch(/^dsh:local:[A-Za-z0-9_-]+$/)
    expect(decodeResourceId(encoded)).toEqual({ location: 'local', id: 'sha256:a:b' })
  })
})

describe('DualHostRouter', () => {
  it('opens a local directory only on the device Host and strips desktop routing metadata', async () => {
    const cloud = client()
    const local = client({ calls: { 'workspace.create': { workspace: { workspaceId: 'w:1', sessionIds: [] } } } })
    const router = new DualHostRouter(cloud as never, () => local as never)

    const result = await router.call<{ workspace: { workspaceId: string } }>('workspace.create', {
      path: '/device/project',
      location: 'local',
    })

    expect(local.call).toHaveBeenCalledWith('workspace.create', { path: '/device/project' })
    expect(cloud.call).not.toHaveBeenCalled()
    expect(decodeResourceId(result.workspace.workspaceId)).toEqual({ location: 'local', id: 'w:1' })
  })

  it('keeps the healthy group when the other Host list fails', async () => {
    const cloud = client({ calls: { 'workspace.list': new Error('signed out') } })
    const local = client({ calls: {
      'workspace.list': { items: [{ workspaceId: 'local-workspace', sessionIds: ['local-session'] }], archivedSessionIds: [] },
    } })
    const router = new DualHostRouter(cloud as never, () => local as never)

    const result = await router.call<{ items: Array<{ workspaceId: string; sessionIds: string[] }> }>('workspace.list', {})

    expect(result.items).toHaveLength(1)
    expect(decodeResourceId(result.items[0]!.workspaceId).location).toBe('local')
    expect(decodeResourceId(result.items[0]!.sessionIds[0]).id).toBe('local-session')
  })

  it('fails closed for an unclassified method', async () => {
    const cloud = client()
    const router = new DualHostRouter(cloud as never, () => null)
    await expect(router.call('new.unclassified', {})).rejects.toThrow(/unclassified/)
    expect(cloud.call).not.toHaveBeenCalled()
  })

  it('keeps cloud account identifiers unchanged', async () => {
    const cloud = client({ calls: { 'account.plugins.list': { items: [{ pluginId: 'office-tools' }] } } })
    const router = new DualHostRouter(cloud as never, () => null)

    await expect(router.call('account.plugins.list', {})).resolves.toEqual({ items: [{ pluginId: 'office-tools' }] })
  })

  it.each([
    'account.businessSkills.list',
    'account.businessSkills.validate',
    'account.businessSkills.publish',
    'account.businessSkills.disable',
    'account.businessSkills.rollback',
  ])('routes %s only to the authenticated cloud Host', async (method) => {
    const result = { accepted: method }
    const cloud = client({ calls: { [method]: result } })
    const local = client()
    const router = new DualHostRouter(cloud as never, () => local as never)

    await expect(router.call(method, {})).resolves.toEqual(result)
    expect(cloud.call).toHaveBeenCalledWith(method, {})
    expect(local.call).not.toHaveBeenCalled()
  })

  it('tags a cloud-only Workspace result at its creation boundary', async () => {
    const cloud = client({ calls: {
      'workspace.importDirectory': { workspace: { workspaceId: 'cloud-workspace', sessionIds: [] } },
    } })
    const router = new DualHostRouter(cloud as never, () => null)

    const result = await router.call<{ workspace: { workspaceId: string } }>('workspace.importDirectory', {
      importId: 'import-1', title: 'Quarterly report', files: [],
    })

    expect(decodeResourceId(result.workspace.workspaceId)).toEqual({ location: 'cloud', id: 'cloud-workspace' })
  })

  it('routes a resource-less default Session creation to the cloud Host', async () => {
    const cloud = client({ calls: { 'session.create': { sessionId: 'default-session' } } })
    const local = client()
    const router = new DualHostRouter(cloud as never, () => local as never)

    const result = await router.call<{ sessionId: string }>('session.create', {})

    expect(cloud.call).toHaveBeenCalledWith('session.create', {})
    expect(local.call).not.toHaveBeenCalled()
    expect(decodeResourceId(result.sessionId)).toEqual({ location: 'cloud', id: 'default-session' })
  })

  it('routes generated Remote calls by their agent resource id', async () => {
    const cloud = client()
    const local = client({ calls: { 'commands/list': [{ name: 'compact' }] } })
    const router = new DualHostRouter(cloud as never, () => local as never)

    await expect(router.call('commands/list', {
      args: { agentId: encodeResourceId('local', 'session:command') },
    })).resolves.toEqual([{ name: 'compact' }])

    expect(local.call).toHaveBeenCalledWith('commands/list', {
      args: { agentId: 'session:command' },
    })
    expect(cloud.call).not.toHaveBeenCalled()
  })

  it('defaults a resource-less generated Remote call to the cloud Host', async () => {
    const cloud = client({ calls: { 'pluginInventory/list': { entries: [] } } })
    const router = new DualHostRouter(cloud as never, () => null)

    await expect(router.call('pluginInventory/list', { args: {} })).resolves.toEqual({ entries: [] })
    expect(cloud.call).toHaveBeenCalledWith('pluginInventory/list', { args: {} })
  })

  it('does not delay cloud frames while the device Host is starting', async () => {
    const cloud = client({ mux: [{ rpcId: 'cloud:1', method: 'session/changed', payload: { sessionId: 'cloud-session' } }] })
    const neverLocal = new Promise<never>(() => {})
    const router = new DualHostRouter(cloud as never, () => null, () => neverLocal)
    const frame = await router.streamMux()[Symbol.asyncIterator]().next() as IteratorYieldResult<{
      rpcId: string
      payload: { sessionId: string }
    }>

    expect(decodeResourceId(frame.value.rpcId)).toEqual({ location: 'cloud', id: 'cloud:1' })
    expect(decodeResourceId(frame.value.payload.sessionId)).toEqual({ location: 'cloud', id: 'cloud-session' })
  })

  it('routes a response to the Host that minted the stream rpc id', async () => {
    const cloud = client()
    const local = client({ mux: [{ rpcId: 'approval:7', method: 'approval.respond', payload: { approvalId: 'approval:1' } }] })
    const router = new DualHostRouter(cloud as never, () => local as never)
    const iterator = router.streamMux()[Symbol.asyncIterator]()
    const frame = await iterator.next() as IteratorYieldResult<{ rpcId: string }>

    await router.respond({ type: 'client-response', rpcId: frame.value.rpcId, result: { ok: true, value: { outcome: 'allowed-once' } } })

    expect(local.respond).toHaveBeenCalledWith({
      type: 'client-response',
      rpcId: 'approval:7',
      result: { ok: true, value: { outcome: 'allowed-once' } },
    })
    expect(cloud.respond).not.toHaveBeenCalled()
  })

  it('keeps local question request and resolved rpc ids aligned', async () => {
    let releaseResolution!: () => void
    const responseSent = new Promise<void>((resolve) => { releaseResolution = resolve })
    const local = {
      call: vi.fn(async () => undefined),
      respond: vi.fn(async (envelope: unknown) => {
        expect(envelope).toMatchObject({ type: 'client-response', rpcId: 'question:request' })
        releaseResolution()
      }),
      streamMux: vi.fn(async function* () {
        yield {
          rpcId: 'question:request',
          payload: { type: 'question/requested', sessionId: 'session:1', questions: [{ id: 'choice' }] },
        }
        await responseSent
        yield {
          rpcId: 'event:resolved',
          payload: {
            type: 'question/resolved', sessionId: 'session:1',
            questionRpcId: 'question:request', outcome: 'answered',
          },
        }
      }),
      streamHost: vi.fn(async function* () { yield* [] }),
    }
    const cloud = client()
    const router = new DualHostRouter(cloud as never, () => local as never)
    const iterator = router.streamMux()[Symbol.asyncIterator]()
    const requested = await iterator.next() as IteratorYieldResult<{
      rpcId: string
      payload: { type: string }
    }>

    await router.respond({
      type: 'client-response', rpcId: requested.value.rpcId,
      result: { ok: true, value: { answers: { choice: 'yes' } } },
    })
    const resolved = await iterator.next() as IteratorYieldResult<{
      rpcId: string
      payload: { questionRpcId: string }
    }>

    expect(resolved.value.payload.questionRpcId).toBe(requested.value.rpcId)
    expect(local.respond).toHaveBeenCalledOnce()
    expect(cloud.respond).not.toHaveBeenCalled()
  })
})
