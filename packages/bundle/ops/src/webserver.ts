/**
 * `@deepseek-ai/dsh-ops/webserver` — registers the prod liveness HTTP route the
 * systemd watchdog expects. The webserver row itself is already mounted by the
 * ops profile's `cordis.patch.yml`; this plugin adds `/health` (exact) on
 * activation and disposes it on deactivation. The `/` route is left for
 * `frontend-static` (mounted alongside) which claims the fallback seat and
 * serves `apps/web/dist/index.html` plus SPA assets.
 *
 * @module @deepseek-ai/dsh-ops/webserver
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'

/** Plugin name used by `cordis.yml`. */
export const name = 'ops-webserver'

/** The webserver row mounts on activation; we register routes once it exists. */
export const inject = ['webServer']

/** No configurable surface; the bind config lives on the webserver row. */
export interface Config {}

function healthPayload(): string {
  return JSON.stringify({
    status: 'ok',
    service: 'dsh-ops',
    uptime_s: Math.floor(process.uptime()),
  })
}

/**
 * Mount the ops liveness route on the webserver.
 * @param ctx - Cordis context carrying the webserver service.
 */
export function apply(ctx: Context): () => void {
  const webServer = ctx.get('webServer')
  if (webServer === undefined) {
    throw new Error('ops-webserver: webServer must be mounted before this plugin activates')
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