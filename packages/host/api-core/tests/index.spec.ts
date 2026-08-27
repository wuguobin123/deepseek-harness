import { describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import {
  RpcId,
  type ApiProxy,
  type RpcPrincipal,
  type RpcRequest,
} from '@deepseek-ai/dsh-host-apiproxy'
import type { TypertGateway } from '@deepseek-ai/dsh-api-gateway'
import { createDeviceHost } from '../src/index.ts'

function testApi(observePrincipal?: (principal: RpcPrincipal) => void): ApiProxy {
  const partial = {
    workspace: {
      list(request: RpcRequest<Record<string, never>>) {
        if (request.principal === undefined) throw new Error('device Host did not attach a local principal')
        observePrincipal?.(request.principal)
        return Promise.resolve({
          rpcId: request.rpcId,
          result: { ok: true as const, value: { items: [], archivedSessionIds: [] } },
        })
      },
    },
    events: {
      async *mux(request: RpcRequest<Record<string, never>>) {
        yield {
          rpcId: RpcId(`push-${request.rpcId}`),
          payload: { type: 'session/subscribed' as const, sessionId: 'session-local', lastSeq: 4 },
        }
      },
      async *host() { /* no baseline Host frame */ },
    },
  }
  return partial as unknown as ApiProxy
}

describe('Xiaowei device Host carrier', () => {
  it('binds loopback and forwards JSON RPC with a local principal', async () => {
    let principal: RpcPrincipal | undefined
    const ready = await createDeviceHost({
      api: testApi((value) => { principal = value }),
    }).listen()
    try {
      expect(new URL(ready.url).hostname).toBe('127.0.0.1')
      const response = await fetch(`${ready.url}/api/workspace.list`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'client-request',
          rpcId: 'workspace-list',
          method: 'workspace.list',
          payload: {},
        }),
      })
      const responseText = await response.text()
      expect(response.status, responseText).toBe(200)
      expect(JSON.parse(responseText)).toEqual({
        type: 'server-response',
        rpcId: 'workspace-list',
        result: { ok: true, value: { items: [], archivedSessionIds: [] } },
      })
      expect(principal).toEqual({ kind: 'local' })
    } finally {
      await ready.close()
    }
  })

  it('dispatches claimed generated Remotes through the Typert Gateway', async () => {
    const invoked: unknown[] = []
    const remote: TypertGateway = {
      claims: endpoint => endpoint === 'commands/list',
      invoke(request) {
        invoked.push(request)
        return Promise.resolve([{ name: 'compact', description: 'Compact context' }])
      },
    }
    const ready = await createDeviceHost({ api: testApi(), remote }).listen()
    try {
      const response = await fetch(`${ready.url}/api/commands/list`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'client-request',
          rpcId: 'command-list',
          method: 'commands/list',
          payload: { args: { agentId: 'session-local' } },
        }),
      })
      const responseText = await response.text()
      expect(response.status, responseText).toBe(200)
      expect(JSON.parse(responseText)).toEqual({
        type: 'server-response',
        rpcId: 'command-list',
        result: { ok: true, value: [{ name: 'compact', description: 'Compact context' }] },
      })
      expect(invoked).toMatchObject([{
        namespace: 'commands',
        method: 'list',
        args: { agentId: 'session-local' },
      }])

      const unknown = await fetch(`${ready.url}/api/commands/missing`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
      expect(unknown.status).toBe(404)
    } finally {
      await ready.close()
    }
  })

  it('projects mux events onto the desktop WebSocket envelope', async () => {
    const ready = await createDeviceHost({ api: testApi() }).listen()
    const socket = new WebSocket(`${ready.url.replace('http:', 'ws:')}/api/events.mux`)
    try {
      const frame = await new Promise<unknown>((resolve, reject) => {
        socket.once('message', (data) => {
          const bytes = Array.isArray(data)
            ? Buffer.concat(data)
            : Buffer.isBuffer(data)
              ? data
              : Buffer.from(data)
          resolve(JSON.parse(bytes.toString('utf8')))
        })
        socket.once('error', reject)
      })
      expect(frame).toMatchObject({
        type: 'server-request',
        method: 'session/subscribed',
        payload: { type: 'session/subscribed', sessionId: 'session-local', lastSeq: 4 },
      })
    } finally {
      socket.terminate()
      await ready.close()
    }
  })
})
