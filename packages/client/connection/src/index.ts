/** Host HTTP bridge for browser-client RPC. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-attachment'
// Activates the webServer Context merge used below.
import type { WebRoute, WebUpgradeRoute } from '@deepseek-ai/dsh-host-webserver'
import { toFetchHandler } from '@deepseek-ai/dsh-host-apiproxy'
import { API_PATH, HOST_EVENTS_PATH, MUX_EVENTS_PATH } from './api-path.ts'
import { bridge, DEFAULT_MAX_REQUEST_BODY_BYTES } from './http-bridge.ts'
import { assertTrustedAuthority, isTrustedApiRequest } from './api-request-trust.ts'
import { authenticateApiRequest } from './api-request-auth.ts'
import type { RpcPrincipal } from '@deepseek-ai/dsh-host-apiproxy/api'
import { HostConnectionService } from './rpc-host.ts'
import { rejectWebSocketUpgrade, WebSocketDownlinks } from './websocket-downlink.ts'

export type {
  ConnectionRpcAuthority,
  ConnectionRpcEndpointMatcher,
  ConnectionRpcHandler,
  ConnectionRpcHandlerOptions,
  HostConnectionHandle,
  HostConnectionRpc,
} from './rpc.ts'
export { HostConnectionService } from './rpc-host.ts'

export { API_PATH, HOST_EVENTS_PATH, MUX_EVENTS_PATH } from './api-path.ts'

/** Stable Cordis plugin name. */
export const name = 'client-connection'

/** Headroom for RPC JSON fields around aggregate base64 image payloads. */
const REQUEST_ENVELOPE_HEADROOM_BYTES = 1024 * 1024

function assertImageBodyCapacity(ctx: Context, maxRequestBodyBytes: number): void {
  const attachments = ctx.get('attachments')
  if (attachments === undefined) return
  const requiredImageBodyBytes = Math.ceil(
    attachments.imageLimits.maxMessageImageBytes * 4 / 3,
  ) + REQUEST_ENVELOPE_HEADROOM_BYTES
  if (maxRequestBodyBytes < requiredImageBodyBytes) {
    throw new Error(
      `client-connection maxRequestBodyBytes (${String(maxRequestBodyBytes)}) must be at least `
      + `${String(requiredImageBodyBytes)} for the configured aggregate image limit`,
    )
  }
}

/** Services required before providing Connection; API Proxy is an optional `/api` fallback. */
export const inject = ['webServer']

/** Plugin config: the deployment's non-loopback serving authorities. */
export interface ConnectionConfig {
  /**
   * Authorities this deployment serves beyond loopback: exact `host:port`, or
   * port-less `host` matching any port. The /api trust fence refuses any
   * request whose Host is neither loopback nor listed here, so a
   * non-loopback (`0.0.0.0`) deployment must declare the names it is reached
   * by (the dsh CLI derives the machine's LAN IP literals itself). An entry
   * that is not a bare, canonical authority fails the plugin load.
   */
  trustedHosts?: string[]
  /** Maximum buffered JSON body for every `/api` request. Default: 300 MiB. */
  maxRequestBodyBytes?: number
}

export const Config: z<ConnectionConfig> = z.object({
  trustedHosts: z.array(String).default([]),
  maxRequestBodyBytes: z.natural().min(1).default(DEFAULT_MAX_REQUEST_BODY_BYTES),
})

/** Native operations that always act on the server host and remain loopback-only. */
const LOOPBACK_METHODS = new Set([
  'host.pickDirectory',
  'host.openPath',
  'settings.openDocument',
  'agentPreset.openDocument',
  'settings.describe',
  'settings.update',
  'settings.replace',
  'settings.mutate',
  'credentials.describe',
  'credentials.set',
  'credentials.unset',
  'llm.discoverModels',
  'llm.providers',
  'llm.models',
  'account.wallet.credit',
  'account.wallet.debit',
  'account.wallet.setQuota',
  'account.wallet.refreshDaily',
  'account.wallet.grantWelcomeBonus',
  'account.modelKeys.provision',
  'account.modelKeys.revoke',
])

/**
 * Agent-preset methods available remotely only to an authenticated account.
 * Host configuration, credentials, model discovery, and account mutations are
 * classified in `LOOPBACK_METHODS` above and never use bearer authorization.
 */
const AUTHENTICATED_CONFIGURATION_METHODS = new Set([
  // Preset list/select stay ordinary authenticated methods: their ids and
  // selection grant no capability beyond session.create's agentPreset field.
  'agentPreset.read',
  'agentPreset.copy',
  'agentPreset.remove',
])
const PUBLIC_METHODS = new Set(['account.signup', 'account.signin', 'account.emailCode', 'account.state', 'account.signout'])
// Invitation management is account-owned and must carry an authenticated
// principal, including when reached through a trusted remote authority.
const AUTHENTICATED_ACCOUNT_METHODS = new Set(['account.invites.create', 'account.invites.list', 'account.invites.rotate'])
/** Direct inference is account-only even on loopback; never downgrade to local. */
const ACCOUNT_INFERENCE_METHOD = 'account.inference.stream'
/** Account web search is cloud-only and requires the authenticated bearer principal. */
const ACCOUNT_WEB_SEARCH_METHOD = 'account.web.search'

/**
 * Mounts the API gateway under the browser transport prefix. Every request on
 * the prefix passes the browser-trust fence first (DNS-rebinding and
 * cross-site defense — [api-request-trust](./api-request-trust.ts));
 * native host operations additionally require loopback. Configuration access
 * requires loopback in single-user compositions or an authenticated account
 * from a declared authority when the identity service is mounted.
 * @param ctx - Host plugin context.
 * @param config - resolved plugin config (schema defaults applied).
 */
export function apply(ctx: Context, config?: ConnectionConfig): void {
  // The Loader resolves schema defaults; hand-built test contexts may pass none.
  const trustedHosts = config?.trustedHosts ?? []
  const maxRequestBodyBytes = config?.maxRequestBodyBytes ?? DEFAULT_MAX_REQUEST_BODY_BYTES
  // Config boundary: a malformed entry fails the load loudly here rather than
  // silently authorizing its hostname prefix at request time.
  for (const entry of trustedHosts) assertTrustedAuthority(entry)
  if (ctx.get('apiProxy') !== undefined) assertImageBodyCapacity(ctx, maxRequestBodyBytes)
  const connection = new HostConnectionService(ctx, trustedHosts)
  const fetchHandler = connection.createSharedFetchHandler(API_PATH, {
    async fetch(request) {
      const pathname = new URL(request.url).pathname
      const method = pathname.startsWith(`${API_PATH}/`)
        ? pathname.slice(API_PATH.length + 1)
        : undefined
      if (method !== undefined && LOOPBACK_METHODS.has(method)) {
        const principal = await requestPrincipal(request, ctx, [])
        if (principal === undefined) {
          return new Response('forbidden', { status: 403 })
        }
      }
      if (method !== undefined && AUTHENTICATED_CONFIGURATION_METHODS.has(method)) {
        const principal = await configurationPrincipal(request, ctx, trustedHosts)
        if (principal === undefined) {
          return new Response('forbidden', { status: 403 })
        }
      }
      if (method !== undefined && AUTHENTICATED_ACCOUNT_METHODS.has(method)) {
        const principal = await requestPrincipal(request, ctx, trustedHosts)
        if (principal?.kind !== 'account') return new Response('forbidden', { status: 403 })
      }
      if (method === ACCOUNT_INFERENCE_METHOD) {
        const principal = await requestPrincipal(request, ctx, trustedHosts)
        if (principal?.kind !== 'account') return new Response('forbidden', { status: 403 })
      }
      if (method === ACCOUNT_WEB_SEARCH_METHOD) {
        const principal = await requestPrincipal(request, ctx, trustedHosts)
        if (principal?.kind !== 'account') return new Response('forbidden', { status: 403 })
      }
      if (request.method === 'GET' && (pathname === MUX_EVENTS_PATH || pathname === HOST_EVENTS_PATH)) {
        return new Response('upgrade required', {
          status: 426,
          headers: { connection: 'Upgrade', upgrade: 'websocket' },
        })
      }
      const apiProxy = ctx.get('apiProxy')
      if (apiProxy === undefined) return new Response('not found', { status: 404 })
      const principal = await requestPrincipal(
        request, ctx, trustedHosts, PUBLIC_METHODS.has(method ?? ''), LOOPBACK_METHODS.has(method ?? ''),
      )
      if (principal === undefined) return new Response('forbidden', { status: 403 })
      return toFetchHandler(apiProxy, principal).fetch(request)
    },
  })
  const route: WebRoute = {
    kind: 'prefix',
    path: API_PATH,
    handler: async (req, res) => {
      const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
      const method = pathname.startsWith(`${API_PATH}/`) ? pathname.slice(API_PATH.length + 1) : ''
      if (method === ACCOUNT_INFERENCE_METHOD) {
        const inferencePrincipal = await requestPrincipal(req, ctx, trustedHosts)
        if (inferencePrincipal?.kind !== 'account') {
          res.writeHead(403)
          res.end('forbidden')
          return
        }
      }
      if (method === ACCOUNT_WEB_SEARCH_METHOD) {
        const searchPrincipal = await requestPrincipal(req, ctx, trustedHosts)
        if (searchPrincipal?.kind !== 'account') {
          res.writeHead(403)
          res.end('forbidden')
          return
        }
      }
      const principal = await requestPrincipal(
        req, ctx, trustedHosts, PUBLIC_METHODS.has(method), LOOPBACK_METHODS.has(method),
      )
      if (principal === undefined) {
        res.writeHead(403)
        res.end('forbidden')
        return
      }
      await bridge(req, res, fetchHandler, maxRequestBodyBytes)
    },
  }
  ctx.effect(() => ctx.webServer.register(route), 'client-connection: /api route')
  ctx.inject(['apiProxy'], (apiCtx) => {
    assertImageBodyCapacity(apiCtx, maxRequestBodyBytes)
    const downlinks = new WebSocketDownlinks(apiCtx.apiProxy)
    const registerDownlink = (
      path: string,
      handle: WebUpgradeRoute['handler'],
    ): void => {
      apiCtx.effect(() => apiCtx.webServer.registerUpgrade({
        path,
        handler: async (req, socket, head) => {
          const principal = await requestPrincipal(req, apiCtx, trustedHosts)
          if (principal === undefined) {
            rejectWebSocketUpgrade(socket)
            return
          }
          ;(req as typeof req & { dshPrincipal?: typeof principal }).dshPrincipal = principal
          return handle(req, socket, head)
        },
      }), `client-connection: ${path} WebSocket`)
    }
    apiCtx.effect(() => () => downlinks.close(), 'client-connection: WebSocket downlinks')
    registerDownlink(MUX_EVENTS_PATH, (req, socket, head) => {
      downlinks.handleMux(
        req, socket, head,
        (req as typeof req & { dshPrincipal?: RpcPrincipal }).dshPrincipal,
      )
    })
    registerDownlink(HOST_EVENTS_PATH, (req, socket, head) => {
      downlinks.handleHost(
        req, socket, head,
        (req as typeof req & { dshPrincipal?: RpcPrincipal }).dshPrincipal,
      )
    })
  })
}

async function requestPrincipal(
  request: Request | import('node:http').IncomingMessage,
  ctx: Context,
  trustedHosts: readonly string[],
  allowLocal = false,
  preserveLocalManagement = false,
): Promise<RpcPrincipal | undefined> {
  // Authentication never substitutes for the browser/DNS trust fence. A
  // valid bearer presented to an attacker-controlled Host is still rejected.
  if (!isTrustedApiRequest(request, trustedHosts)) return undefined
  // A signed-in desktop carries its bearer over loopback too. Preserve that
  // account identity so new Sessions receive their durable owner; an
  // unauthenticated loopback caller remains the local management plane.
  // Methods that act on the host machine retain the local principal because
  // their API handlers deliberately reject account-scoped administration.
  const loopback = isTrustedApiRequest(request, [])
  if (preserveLocalManagement && loopback) return { kind: 'local' as const }
  const authenticated = await authenticateApiRequest({ headers: request.headers }, ctx)
  if (authenticated !== undefined) return authenticated
  if (loopback) return { kind: 'local' as const }
  // `allowLocal` only relaxes the identity requirement for public account
  // methods. It must never relax the Host/trustedHosts fence: an untrusted
  // Host may not obtain a local principal merely by selecting account.*.
  if (allowLocal) return { kind: 'local' as const }
  return undefined
}

/**
 * Authorize the remaining remotely readable agent-preset methods from a
 * trusted authority carrying a live account bearer. Host configuration and
 * credentials are rejected earlier by the loopback method fence.
 */
async function configurationPrincipal(
  request: Request | import('node:http').IncomingMessage,
  ctx: Context,
  trustedHosts: readonly string[],
): Promise<RpcPrincipal | undefined> {
  if (isTrustedApiRequest(request, [])) return requestPrincipal(request, ctx, [])
  if (ctx.get('identity') === undefined) return undefined
  return requestPrincipal(request, ctx, trustedHosts)
}
