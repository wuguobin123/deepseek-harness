/**
 * Loopback HTTP and WebSocket carrier for the Xiaowei device Host.
 *
 * The carrier exposes legacy ApiProxy unary methods and generated Typert
 * Remotes without adding account or cloud services. It binds to loopback only
 * and gives every ApiProxy request the local principal.
 * @module @deepseek-ai/dsh-host-api-core
 */

import { randomUUID } from 'node:crypto'
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import { Readable } from 'node:stream'
import { WebSocket, WebSocketServer } from 'ws'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { clientRequestSchema } from '@deepseek-ai/dsh-host-apiproxy/api'
import {
  RpcId,
  toFetchHandler,
  type ApiProxy,
  type ClientRequest,
  type RpcPrincipal,
  type RpcResult,
} from '@deepseek-ai/dsh-host-apiproxy'
import { invokeRemoteRpc, type TypertGateway } from '@deepseek-ai/dsh-api-gateway'

const MUX_PATH = '/api/events.mux'
const HOST_PATH = '/api/events.host'
const LOCAL_PRINCIPAL: RpcPrincipal = { kind: 'local' }

/** Stable Cordis plugin name. */
export const name = 'xiaowei-device-host'

/** The carrier starts after both local unary dispatchers are available. */
export const inject = ['apiProxy', 'typertGateway']

/** Cordis plugin configuration for the loopback listener. */
export interface Config {
  /** Requested loopback port. Zero selects an available port. */
  port?: number
  /** Whether to print the supervisor readiness marker. */
  printUrl?: boolean
}

/** Validated device carrier configuration. */
export const Config: z<Config> = z.object({
  port: z.natural().max(65535).default(0),
  printUrl: z.boolean().default(true),
})

/** Options for the loopback carrier. */
export interface DeviceHostOptions {
  /** Composed local ApiProxy implementation. */
  api: ApiProxy
  /** Requested loopback port. Zero selects an available port. */
  port?: number
  /** Generated Remote dispatcher mounted beside the legacy ApiProxy. */
  remote?: TypertGateway
}

/** A listening device Host and its shutdown operation. */
export interface ListeningDeviceHost {
  /** Loopback HTTP origin used by desktop's ApiClient. */
  url: string
  /** Stop accepting requests and terminate open event streams. */
  close(): Promise<void>
}

/** Device Host before it starts listening. */
export interface DeviceHost {
  /** Underlying Node server, exposed for lifecycle integration. */
  server: Server
  /** Bind to 127.0.0.1 and return the selected origin. */
  listen(): Promise<ListeningDeviceHost>
}

/** Convert Node request headers into Fetch headers without widening arrays. */
function fetchHeaders(input: IncomingHttpHeaders): Headers {
  const headers = new Headers()
  for (const [name, value] of Object.entries(input)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item)
    } else {
      headers.set(name, value)
    }
  }
  return headers
}

/**
 * Create the device-only loopback carrier for the local unary dispatchers.
 * @param options - local dispatchers and requested loopback port.
 * @returns an unbound carrier whose listener owns its lifecycle.
 */
export function createDeviceHost(options: DeviceHostOptions): DeviceHost {
  const { api, port = 0, remote } = options
  const handler = toFetchHandler(api, LOCAL_PRINCIPAL)
  const sockets = new WebSocketServer({ noServer: true })
  const pumps = new Set<Promise<void>>()
  const server = createServer((request, response) => {
    const method = request.method ?? 'GET'
    const init: RequestInit & { duplex?: 'half' } = {
      method,
      headers: fetchHeaders(request.headers),
      ...(method === 'GET' || method === 'HEAD'
        ? {}
        : { body: Readable.toWeb(request) as ReadableStream<Uint8Array>, duplex: 'half' }),
    }
    const fetchRequest = new Request(`http://127.0.0.1${request.url ?? '/'}`, init)
    const result = remote !== undefined && claimedRemote(fetchRequest, remote)
      ? remoteResponse(fetchRequest, remote)
      : handler.fetch(fetchRequest)
    void result.then(async (fetchResponse) => {
      response.writeHead(fetchResponse.status, Object.fromEntries(fetchResponse.headers.entries()))
      response.end(Buffer.from(await fetchResponse.arrayBuffer()))
    }).catch((error: unknown) => {
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      response.end(error instanceof Error ? error.message : String(error))
    })
  })

  server.on('upgrade', (request, socket, head) => {
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    if (path !== MUX_PATH && path !== HOST_PATH) {
      socket.destroy()
      return
    }
    sockets.handleUpgrade(request, socket, head, (websocket) => {
      const abort = new AbortController()
      websocket.once('close', () => { abort.abort() })
      websocket.once('error', () => { abort.abort() })
      websocket.once('message', () => { websocket.close(1008, 'downlink only') })
      const rpcRequest = { rpcId: RpcId(randomUUID()), payload: {}, principal: LOCAL_PRINCIPAL }
      const frames = path === MUX_PATH
        ? api.events.mux(rpcRequest, abort.signal)
        : api.events.host(rpcRequest, abort.signal)
      const pump = (async (): Promise<void> => {
        try {
          for await (const frame of frames) {
            if (websocket.readyState !== WebSocket.OPEN) break
            websocket.send(JSON.stringify({
              type: 'server-request',
              rpcId: frame.rpcId,
              method: frame.payload.type,
              payload: frame.payload,
            }))
          }
        } finally {
          abort.abort()
          if (websocket.readyState === WebSocket.OPEN) websocket.close()
        }
      })()
      pumps.add(pump)
      void pump.finally(() => { pumps.delete(pump) })
    })
  })

  return {
    server,
    listen: () => new Promise<ListeningDeviceHost>((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, '127.0.0.1', () => {
        server.off('error', reject)
        const address = server.address()
        if (typeof address !== 'object' || address === null) {
          reject(new Error('device Host did not receive a TCP address'))
          return
        }
        resolve({
          url: `http://127.0.0.1:${address.port}`,
          close: async () => {
            for (const socket of sockets.clients) socket.terminate()
            await Promise.allSettled([...pumps])
            await new Promise<void>((resolveClose) => { server.close(() => { resolveClose() }) })
          },
        })
      })
    }),
  }
}

function claimedRemote(request: Request, remote: TypertGateway): boolean {
  const path = new URL(request.url).pathname
  return path.startsWith('/api/') && remote.claims(path.slice('/api/'.length))
}

async function remoteResponse(request: Request, remote: TypertGateway): Promise<Response> {
  if (request.method !== 'POST') return new Response('not found', { status: 404 })
  const mediaType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (mediaType !== 'application/json') return new Response('content type must be application/json', { status: 415 })
  let body: unknown
  try { body = await request.json() } catch { return new Response('body is not JSON', { status: 400 }) }
  const parsed = clientRequestSchema.safeParse(body)
  if (!parsed.success) {
    const rawId = (body as { rpcId?: unknown } | null)?.rpcId
    const rpcId = RpcId(typeof rawId === 'string' ? rawId : 'invalid-client-request')
    return remoteEnvelope(rpcId, {
      ok: false,
      error: { code: 'bad-request', message: 'invalid client-request message', details: { issues: parsed.error.issues } },
    })
  }
  const message: ClientRequest = parsed.data
  const endpoint = new URL(request.url).pathname.slice('/api/'.length)
  if (message.method !== endpoint) {
    return remoteEnvelope(message.rpcId, {
      ok: false,
      error: {
        code: 'bad-request',
        message: `method "${message.method}" does not match path "${endpoint}"`,
        details: { issues: [] },
      },
    })
  }
  return remoteEnvelope(message.rpcId, await invokeRemoteRpc(remote, endpoint, message.payload, request.signal))
}

function remoteEnvelope(rpcId: ReturnType<typeof RpcId>, result: RpcResult<unknown>): Response {
  return Response.json({ type: 'server-response', rpcId, result })
}

/** Mount the loopback carrier inside the same Cordis realm as ApiProxy. */
export async function apply(ctx: Context, config: Config): Promise<void> {
  await ctx.effect(async () => {
    const api = ctx.get('apiProxy')
    if (api === undefined) throw new Error('device Host requires the local ApiProxy service')
    const remote = ctx.get('typertGateway')
    if (remote === undefined) throw new Error('device Host requires the Typert Remote Gateway')
    const ready = await createDeviceHost({ api, remote, port: config.port ?? 0 }).listen()
    if (config.printUrl !== false) process.stdout.write(`dsh web: ${ready.url}\n`)
    return async () => { await ready.close() }
  })
}
