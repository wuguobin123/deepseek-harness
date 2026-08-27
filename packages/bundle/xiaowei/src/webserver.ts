/**
 * Xiaowei's exact liveness route for the long-running production service.
 *
 * @module @deepseek-ai/dsh-xiaowei/webserver
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'

/** Plugin name used by the Xiaowei bundle patch. */
export const name = 'xiaowei-webserver'

/** The bound HTTP server is required before the liveness route can register. */
export const inject = ['webServer']

/** No configurable surface; the bind configuration belongs to the webserver row. */
export interface Config {}

function healthPayload(): string {
  return JSON.stringify({
    status: 'ok',
    service: 'dsh-xiaowei',
    uptime_s: Math.floor(process.uptime()),
  })
}

/**
 * Register the exact health route and remove it during plugin teardown.
 * @param ctx - Cordis context carrying the webserver service.
 * @returns disposer for the registered route.
 */
export function apply(ctx: Context): () => void {
  const webServer = ctx.get('webServer')
  if (webServer === undefined) {
    throw new Error('xiaowei-webserver: webServer must be mounted before this plugin activates')
  }
  const healthRoute: WebRoute = {
    kind: 'exact',
    path: '/health',
    handler(_req: IncomingMessage, res: ServerResponse): void {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(healthPayload())
    },
  }
  const disposeHealth = webServer.register(healthRoute)
  return () => {
    disposeHealth()
  }
}
