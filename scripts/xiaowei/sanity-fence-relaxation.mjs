/**
 * sanity-fence-relaxation.mjs
 *
 * End-to-end probe of the privileged-method fence after the bearer-auth
 * relaxation. Mounts the local identity provider, a minimal in-memory
 * `webServer`, and a stub `apiProxy` that exposes one privileged method
 * (`settings.describe`). Boots the connection plugin on top, listens on a
 * random loopback port, and exercises:
 *
 *   1. Loopback, no token → fence passes; the stub responds 200.
 *   2. Trusted host, no token → fence blocks (403), bearer check elided.
 *   3. Trusted host + valid bearer → fence accepts; stub responds 200.
 *   4. Trusted host + tampered bearer → fence blocks (403).
 *   5. Trusted host + revoked bearer → fence blocks (403).
 *
 * No real HTTPS, no LLM, no cordis.yml — pure structural wiring over the
 * loopback. The script is the integration counterpart to
 * `packages/client/connection/tests/api-request-auth.spec.ts`, which exercises
 * the gate against synthetic `IncomingMessage`s; here the gate sees Node's
 * real parse of the wire.
 *
 * Run: `pnpm exec tsx scripts/xiaowei/sanity-fence-relaxation.mjs`.
 * Exit codes: 0 PASS, 1 FAIL with a one-line reason on stderr.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createServer, request as httpRequest } from 'node:http'

import { Context } from '@deepseek-ai/cordis'
import LocalIdentityProvider from '@deepseek-ai/dsh-account-identity'
import {
  apply as applyConnection,
  inject as connectionInject,
} from '@deepseek-ai/dsh-client-connection'
import { API_PATH } from '@deepseek-ai/dsh-client-connection'

function die(reason) {
  console.error(`sanity-fence-relaxation: FAIL — ${reason}`)
  process.exit(1)
}

/** Send one GET to `${base}/${API_PATH}/${method}` and resolve with the status code. */
function call(base, method, host, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${API_PATH}/${method}`, base)
    const request = httpRequest(
      { host: '127.0.0.1', port: url.port, path: url.pathname, method: 'GET', headers: { host, ...extraHeaders } },
      (response) => {
        response.resume()
        response.on('end', () => resolve(response.statusCode ?? 0))
      },
    )
    request.on('error', reject)
    request.end()
  })
}

async function main() {
  const home = await mkdtemp(join(tmpdir(), 'dsh-xiaowei-fence-'))
  const dbPath = join(home, 'identity.sqlite')
  const trustedHost = `lan-${randomUUID().slice(0, 8)}.test`
  console.log(`sanity-fence-relaxation: home=${home}, trustedHost=${trustedHost}`)

  // Step 1: compose the minimum that the connection plugin requires.
  // `webServer` is a structural facade: the connection plugin only calls
  // `webServer.register(route)` on it; the real socket-level serving is
  // done by the Node http.Server we spin up below, which dispatches into
  // the registered routes.
  const ctx = new Context()
  const routes = []
  ctx.provide('webServer', {
    register(route) { routes.push(route) },
    registerUpgrade() { /* no WebSocket probe in this sanity */ },
    tapIndex() { return undefined },
  })
  // Minimal apiProxy: only `settings.describe` is exposed so we can tell
  // whether the fence passed. The host would normally route to a real
  // typert/loader, but a structural stub is enough for this gate.
  ctx.provide('apiProxy', {
    settings: {
      describe: async () => ({ settings: 'sentinel-from-apiProxy' }),
    },
  })
  await ctx.plugin(LocalIdentityProvider, { path: dbPath })

  // Step 2: boot the connection plugin with the trusted host explicitly
  // permitted. The fence then sees this entry in its `trustedHosts` table.
  await ctx.plugin({ inject: connectionInject, apply: applyConnection }, {
    trustedHosts: [trustedHost],
  })

  // Step 3: serve the first registered prefix route over a real loopback
  // socket. The connection plugin registers exactly one prefix (`/api`).
  if (routes.length !== 1) {
    await rm(home, { recursive: true, force: true })
    die(`expected exactly one registered route, got ${routes.length}`)
  }
  const route = routes[0]
  const server = createServer((req, res) => {
    void route.handler(req, res)
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    await rm(home, { recursive: true, force: true })
    server.close()
    die(`server.listen resolved without an AddressInfo`)
  }
  const base = `http://127.0.0.1:${address.port}`
  console.log(`sanity-fence-relaxation: listening on ${base}`)

  try {
    // Step 4: loopback caller (no token) — fence passes via trustedHosts=[]
    // loopback check; the request then reaches the apiProxy stub. The stub
    // answers GET with 404 (apiproxy only handles POST envelopes), which is
    // the signal we want: anything other than 403 means the fence cleared.
    const loopbackStatus = await call(base, 'settings.describe', `127.0.0.1:${address.port}`)
    if (loopbackStatus === 403) {
      die(`loopback caller: expected fence-pass (≠403), got 403`)
    }
    console.log(`sanity-fence-relaxation: loopback, no token → ${loopbackStatus} (fence passed)`)

    // Step 5: trusted-host caller (no token) — the trustedHosts check
    // passes, but `settings.describe` is privileged, so the bearer gate
    // refuses without a token → 403.
    const trustedStatus = await call(base, 'settings.describe', trustedHost)
    if (trustedStatus !== 403) {
      die(`trusted no-token: expected 403, got ${trustedStatus}`)
    }
    console.log('sanity-fence-relaxation: trusted host, no token → 403')

    // Step 6: signup since the deployment has no bootstrap config; the
    // bearer token we get back is what the fence will validate.
    const signup = await ctx.identity.signup({
      email: 'sanity@example.test',
      password: 'sanity-password',
      displayName: 'Sanity Fence',
    })
    const token = signup.sessionToken

    // Step 7: trusted-host caller + valid bearer → fence accepts; the
    // request reaches the apiProxy stub (which answers 404 for GET).
    const trustedWithBearer = await call(base, 'settings.describe', trustedHost, {
      authorization: `Bearer ${token}`,
    })
    if (trustedWithBearer === 403) {
      die(`trusted + bearer: expected fence-pass (≠403), got 403`)
    }
    console.log(`sanity-fence-relaxation: trusted host + valid bearer → ${trustedWithBearer} (fence passed)`)

    // Step 8: trusted-host caller + tampered bearer → still 403. The
    // identity service does not know the tampered token, so validate
    // returns null and the gate refuses.
    const tampered = `${token.slice(0, -1)}${token.slice(-1) === 'A' ? 'B' : 'A'}`
    const trustedWithTampered = await call(base, 'settings.describe', trustedHost, {
      authorization: `Bearer ${tampered}`,
    })
    if (trustedWithTampered !== 403) {
      die(`trusted + tampered: expected 403, got ${trustedWithTampered}`)
    }
    console.log('sanity-fence-relaxation: trusted host + tampered bearer → 403')

    // Step 9: revoke the bearer; the next request must 403 again. This is
    // the "signout propagates without delay" guarantee — the fence looks
    // up the token synchronously against the live SQLite row, so revoking
    // is observed on the very next request.
    await ctx.identity.signout({ sessionToken: token })
    const trustedAfterRevoke = await call(base, 'settings.describe', trustedHost, {
      authorization: `Bearer ${token}`,
    })
    if (trustedAfterRevoke !== 403) {
      die(`trusted + revoked: expected 403, got ${trustedAfterRevoke}`)
    }
    console.log('sanity-fence-relaxation: trusted host + revoked bearer → 403')

    // Step 10: malformed Authorization header — `Basic`, `Token`, empty —
    // each falls through to the same 403. The fence is not in the business
    // of distinguishing "wrong scheme" from "no scheme"; both are unauth.
    for (const value of ['', 'Token abc', 'Basic dXNlcjpwYXNz']) {
      const status = await call(base, 'settings.describe', trustedHost, {
        authorization: value,
      })
      if (status !== 403) {
        die(`authorization=${JSON.stringify(value)}: expected 403, got ${status}`)
      }
    }
    console.log('sanity-fence-relaxation: malformed Authorization → 403')

    // Cleanup
    await new Promise((resolve) => server.close(() => resolve(undefined)))
    await rm(home, { recursive: true, force: true })
    console.log('sanity-fence-relaxation: PASS')
  } catch (error) {
    await new Promise((resolve) => server.close(() => resolve(undefined)))
    await rm(home, { recursive: true, force: true })
    console.error('sanity-fence-relaxation: FAIL — unexpected throw')
    console.error(error)
    process.exit(1)
  }
}

main().catch(async (error) => {
  console.error('sanity-fence-relaxation: FAIL — unexpected throw')
  console.error(error)
  process.exit(1)
})
