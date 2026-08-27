import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebSocketServer } from 'ws'
import { openWsStream } from '../src/main/sse-proxy'

const servers: WebSocketServer[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve) => {
    for (const client of server.clients) client.terminate()
    server.close(() =>{  resolve() })
  })))
})

async function startServer(autoPong: boolean): Promise<{ server: WebSocketServer; url: string }> {
  const server = new WebSocketServer({ port: 0, autoPong })
  servers.push(server)
  await once(server, 'listening')
  const address = server.address() as AddressInfo
  return { server, url: `ws://127.0.0.1:${address.port}` }
}

describe('desktop WebSocket heartbeat', () => {
  it('fails a silent carrier that accepts TCP but never returns pong', async () => {
    const { url } = await startServer(false)
    const stream = openWsStream(url, {
      heartbeatIntervalMs: 10,
      heartbeatTimeoutMs: 10,
    })

    await expect(stream.next()).rejects.toMatchObject({
      code: 'HEARTBEAT_TIMEOUT',
      message: 'WS heartbeat received no pong for 10ms',
    })
  })

  it('keeps a quiet carrier alive while protocol pongs continue', async () => {
    const { server, url } = await startServer(true)
    const abort = new AbortController()
    let pings = 0
    server.on('connection', (socket) => {
      socket.on('ping', () => { pings += 1 })
    })
    const stream = openWsStream(url, {
      signal: abort.signal,
      heartbeatIntervalMs: 10,
      heartbeatTimeoutMs: 250,
    })
    const pending = stream.next()

    await vi.waitFor(() => { expect(pings).toBeGreaterThanOrEqual(3) })
    abort.abort()
    await expect(pending).resolves.toEqual({ done: true, value: undefined })
  })

  it('continues to deliver application frames between heartbeat probes', async () => {
    const { server, url } = await startServer(true)
    server.on('connection', (socket) => {
      socket.send(JSON.stringify({
        type: 'server-request',
        rpcId: 'heartbeat-frame',
        method: 'session/subscribed',
        payload: { type: 'session/subscribed', sessionId: 'session-heartbeat', lastSeq: -1 },
      }))
    })
    const stream = openWsStream(url, {
      heartbeatIntervalMs: 10,
      heartbeatTimeoutMs: 10,
    })

    await expect(stream.next()).resolves.toEqual({
      done: false,
      value: {
        rpcId: 'heartbeat-frame',
        method: 'session/subscribed',
        payload: { type: 'session/subscribed', sessionId: 'session-heartbeat', lastSeq: -1 },
      },
    })
    await stream.return(undefined)
  })
})
