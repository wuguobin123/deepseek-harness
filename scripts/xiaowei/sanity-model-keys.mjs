/**
 * Real-store sanity probe for per-user New-API credentials.
 *
 * The upstream management API is a deterministic in-process transport;
 * SQLite, AES-GCM storage, ensure, internal resolution, restart, and upstream
 * revocation run through the production provider.
 *
 * Run: `pnpm exec tsx scripts/xiaowei/sanity-model-keys.mjs`.
 */
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LocalUserModelKeyProvider from '@deepseek-ai/dsh-account-model-keys'

function fail(message) {
  throw new Error(`sanity-model-keys: ${message}`)
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } })
}

function newApiTransport() {
  const tokens = []
  const revoked = []
  let nextId = 1
  const fetch = async (input, init = {}) => {
    const url = new URL(String(input))
    if (url.pathname.endsWith('/user/login')) return json({ success: true, data: { id: 7 } }, 200, { 'set-cookie': 'session=sanity; Path=/; HttpOnly' })
    if (url.pathname.endsWith('/token/') && init.method === 'GET') {
      const name = url.searchParams.get('name')
      return json({ success: true, data: { items: tokens.filter(token => token.name === name) } })
    }
    if (url.pathname.endsWith('/token/') && init.method === 'POST') {
      const body = JSON.parse(String(init.body))
      const token = { id: nextId++, name: body.name, key: `new-api-sanity-${randomUUID()}` }
      tokens.push(token)
      return json({ success: true, data: { id: token.id, key: token.key } })
    }
    const match = url.pathname.match(/\/token\/(\d+)(\/key)?$/)
    if (match?.[2] === '/key') {
      const token = tokens.find(item => item.id === Number(match[1]))
      return json({ success: true, data: { key: token?.key } })
    }
    if (match !== null && init.method === 'DELETE') {
      revoked.push(Number(match[1]))
      return json({ success: true, data: {} })
    }
    return json({ success: false, message: 'unexpected sanity request' }, 404)
  }
  return { fetch, tokens, revoked }
}

function config(path, masterKey) {
  return {
    path,
    masterKey,
    newApi: {
      adminUrl: 'https://new-api.test/api', apiBaseUrl: 'https://new-api.test/v1',
      username: 'admin', password: 'password', userGroup: 'default',
      tokenQuota: 0, tokenUnlimitedQuota: true, tokenExpiresDays: 0,
      modelLimitsEnabled: true, route: 'xiaowei-minimax', model: 'MiniMax-M3',
      inputPriceMicrosPerToken: 1, outputPriceMicrosPerToken: 8,
      timeoutMs: 1_000, retries: 0,
    },
  }
}

async function main() {
  const home = await mkdtemp(join(tmpdir(), 'dsh-xiaowei-model-keys-'))
  try {
    const databasePath = join(home, 'user-model-keys.sqlite')
    const masterKey = randomBytes(32).toString('base64url')
    const upstream = newApiTransport()
    globalThis.fetch = upstream.fetch
    const userId = `u_${randomUUID().replaceAll('-', '').slice(0, 16)}`
    const ctx = new Context()
    await ctx.plugin(LocalUserModelKeyProvider, config(databasePath, masterKey))

    const first = await ctx.userModelKeys.provision({ userId })
    const repeat = await ctx.userModelKeys.provision({ userId })
    if (first.keyId !== repeat.keyId || upstream.tokens.length !== 1) fail('ensure was not idempotent')
    if ('keyValue' in first || 'token' in first) fail('provision returned upstream secret')
    const active = await ctx.userModelKeys.resolveActive({ userId, route: 'xiaowei-minimax' })
    if (active?.token !== upstream.tokens[0].key) fail('internal credential resolution failed')
    if ((await readFile(databasePath)).includes(Buffer.from(active.token))) fail('SQLite contains plaintext token')

    const restarted = new Context()
    await restarted.plugin(LocalUserModelKeyProvider, config(databasePath, masterKey))
    const afterRestart = await restarted.userModelKeys.provision({ userId })
    if (afterRestart.keyId !== first.keyId || upstream.tokens.length !== 1) fail('restart did not reuse active row')

    const result = await ctx.userModelKeys.revoke({ keyId: first.keyId })
    if (!result.revoked || upstream.revoked[0] !== upstream.tokens[0].id) fail('upstream revocation failed')
    if (await ctx.userModelKeys.resolveActive({ userId, route: 'xiaowei-minimax' }) !== undefined) fail('revoked token still resolves')

    const missingMaster = new Context()
    let rejectedMissingMaster = false
    try {
      await missingMaster.plugin(LocalUserModelKeyProvider, config(join(home, 'missing-master.sqlite'), ''))
    } catch {
      rejectedMissingMaster = true
    }
    if (!rejectedMissingMaster) fail('empty master key was accepted')
    console.log('sanity-model-keys: PASS')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
