/**
 * Tests for `apps/desktop/src/renderer/transport.ts`.
 *
 * The `IpcApiClientAdapter` subclasses `AbstractApiClient` and routes every
 * transport call through `bridge().request(...)` / `bridge().respond(...)` /
 * `bridge().subscribeMux/Host(...)`. The renderer MUST distinguish
 * `respond()` (carries a `ClientResponse` envelope, no `method` field,
 * hits the dedicated `/api/respond` carrier) from `request('respond', body)`
 * (carries a `ClientRequest` envelope with `method: 'respond'`, hits the
 * same path but with the wrong envelope type).
 *
 * The upstream `/api/respond` handler
 * (`packages/host/apiproxy/src/fetch/handler.ts:329-332`) runs the body
 * through `clientResponseSchema.safeParse`. A `ClientRequest` body fails
 * the parse and the carrier returns `{ accepted: false, reason: 'bad-response' }`.
 * From the renderer's perspective: the buttons (拒绝/允许一次) fire onClick,
 * `pending.answer()` throws `approval response rejected: bad-response`,
 * `ApprovalPanel.answer()` re-arms the buttons via `.catch(() => setAnswered(false))`,
 * and the user sees "无反应".
 *
 * The dev bridge (`dev-bridge.ts:110`) sends the right envelope directly.
 * This test exercises the packaged-app IPC adapter.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSlotTransport, type WorkbenchApiTransport, type WorkbenchResponse } from '../src/renderer/transport'
import type { ClientResponse } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import type { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'

interface CapturedBridgeCall {
  channel: 'request' | 'respond' | 'subscribeMux' | 'subscribeHost'
  args: unknown
}

function buildBridge(): WorkbenchApiTransport & { calls: CapturedBridgeCall[] } {
  const calls: CapturedBridgeCall[] = []
  const noop = async (): Promise<() => Promise<void>> => async () => undefined
  const bridge: WorkbenchApiTransport & { calls: CapturedBridgeCall[] } = {
    calls,
    request: <R = unknown>(method: string, payload: unknown): Promise<WorkbenchResponse<R>> => {
      calls.push({ channel: 'request', args: { method, payload } })
      return Promise.resolve({ ok: true, value: undefined as R })
    },
    respond: (
      rpcId: string,
      value: unknown,
      error?: { code: string; message: string; details?: Record<string, unknown> },
    ): Promise<void> => {
      calls.push({ channel: 'respond', args: { rpcId, value, error } })
      return Promise.resolve()
    },
    subscribeMux: (..._a: unknown[]): Promise<() => Promise<void>> => {
      calls.push({ channel: 'subscribeMux', args: _a })
      return Promise.resolve(noop())
    },
    subscribeHost: (..._a: unknown[]): Promise<() => Promise<void>> => {
      calls.push({ channel: 'subscribeHost', args: _a })
      return Promise.resolve(noop())
    },
  }
  return bridge
}

describe('desktop connection authority', () => {
  it('reports the configured Host authority independently of the file: renderer URL', () => {
    const bridge = buildBridge()
    expect(createSlotTransport(bridge, true).isLoopback).toBe(true)
    expect(createSlotTransport(bridge, false).isLoopback).toBe(false)
  })
})

describe('IpcApiClientAdapter.respond()', () => {
  let bridge: ReturnType<typeof buildBridge>
  let api: ReturnType<typeof createSlotTransport>['createApiClient'] extends () => infer T ? T : never

  beforeEach(() => {
    bridge = buildBridge()
    api = createSlotTransport(bridge, true).createApiClient()
  })

  it('routes ClientResponse (ok) through bridge().respond, NOT bridge().request', async () => {
    const message: ClientResponse = {
      type: 'client-response',
      rpcId: 'r-approve-1' as RpcId,
      result: { ok: true, value: { sessionId: 's1', approvalId: 'a1', outcome: 'allowed-once' } },
    }
    const receipt = await api.respond(message)
    expect(receipt).toEqual({ accepted: true })

    // The fix path: respond() must NOT go through request().
    const requestCalls = bridge.calls.filter(c => c.channel === 'request')
    expect(requestCalls).toHaveLength(0)

    // It must hit bridge().respond with (rpcId, value).
    const respondCalls = bridge.calls.filter(c => c.channel === 'respond')
    expect(respondCalls).toHaveLength(1)
    expect(respondCalls[0].args).toEqual({
      rpcId: 'r-approve-1',
      value: { sessionId: 's1', approvalId: 'a1', outcome: 'allowed-once' },
    })
  })

  it('routes ClientResponse (error) through bridge().respond with the error arg', async () => {
    const message: ClientResponse = {
      type: 'client-response',
      rpcId: 'r-reject-1' as RpcId,
      result: { ok: false, error: { code: 'cancelled', message: 'user cancelled', details: {} } },
    }
    const receipt = await api.respond(message)
    expect(receipt).toEqual({ accepted: true })

    const requestCalls = bridge.calls.filter(c => c.channel === 'request')
    expect(requestCalls).toHaveLength(0)

    const respondCalls = bridge.calls.filter(c => c.channel === 'respond')
    expect(respondCalls).toHaveLength(1)
    expect(respondCalls[0].args).toEqual({
      rpcId: 'r-reject-1',
      value: undefined,
      error: { code: 'cancelled', message: 'user cancelled', details: {} },
    })
  })

  it('does not wrap the body in a ClientRequest envelope with method:"respond"', async () => {
    // Pre-fix regression: doFetch would call bridge().request('respond', ClientResponse).
    // The fix sends bridge().respond(rpcId, value) and never touches request().
    const message: ClientResponse = {
      type: 'client-response',
      rpcId: 'r-2' as RpcId,
      result: { ok: true, value: { outcome: 'rejected' } },
    }
    await api.respond(message)

    for (const call of bridge.calls) {
      if (call.channel !== 'request') continue
      const args = call.args as { method?: string; payload?: unknown }
      expect(args.method).not.toBe('respond')
    }
  })
})

describe('IPC generic Remote transport', () => {
  it('unwraps the fetch ClientRequest and reconstructs its correlated ServerResponse', async () => {
    const bridge = buildBridge()
    bridge.request = <R = unknown>(method: string, payload: unknown): Promise<WorkbenchResponse<R>> => {
      bridge.calls.push({ channel: 'request', args: { method, payload } })
      return Promise.resolve({ ok: true, value: { entries: [] } as R })
    }
    const fetchRemote = createSlotTransport(bridge, true).fetch
    const response = await fetchRemote(
      new URL('http://dsh.internal/api/pluginInventory/list'),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'client-request',
          rpcId: 'r-plugin-inventory',
          method: 'pluginInventory/list',
          payload: { args: {} },
        }),
      },
    )

    expect(bridge.calls).toEqual([{
      channel: 'request',
      args: { method: 'pluginInventory/list', payload: { args: {} } },
    }])
    expect(await response.json()).toEqual({
      type: 'server-response',
      rpcId: 'r-plugin-inventory',
      result: { ok: true, value: { entries: [] } },
    })
  })
})

describe('IPC downlink lifecycle', () => {
  it('yields stream errors so the connection controller can reconnect', async () => {
    const bridge = buildBridge()
    let listener: ((envelope: unknown) => void) | undefined
    bridge.subscribeMux = async (next): Promise<() => Promise<void>> => {
      listener = next
      return async () => undefined
    }
    const api = createSlotTransport(bridge, true).createApiClient()
    const abort = new AbortController()
    const iterator = api.events.mux({}, abort.signal)[Symbol.asyncIterator]()
    const pending = iterator.next()

    await vi.waitFor(() =>{  expect(listener).toBeTypeOf('function') })
    listener?.({
      rpcId: 'desktop-stream-error',
      method: 'stream/error',
      payload: {
        type: 'stream/error',
        error: { code: 'internal', message: 'event stream stopped', details: {} },
      },
    })

    await expect(pending).resolves.toEqual({
      done: false,
      value: {
        rpcId: 'desktop-stream-error',
        payload: {
          type: 'stream/error',
          error: { code: 'internal', message: 'event stream stopped', details: {} },
        },
      },
    })
    abort.abort()
    await iterator.return?.()
  })
})
