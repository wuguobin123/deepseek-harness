import { readFileSync } from 'node:fs'

const [sourceEnvPath, expectedUnused = '404', origin = 'http://127.0.0.1:18082', expectedDetails = '404'] = process.argv.slice(2)
if (sourceEnvPath === undefined) throw new Error('usage: acceptance-probe.mjs <source-env> [expected-unused-status]')

function decode(raw) {
  const value = raw.trim()
  if (value.startsWith('"') && value.endsWith('"')) return JSON.parse(value)
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1)
  return value
}

const env = new Map()
for (const line of readFileSync(sourceEnvPath, 'utf8').split(/\r?\n/)) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line)
  if (match !== null) env.set(match[1], decode(match[2]))
}
const token = env.get('XIAOWEI_BUSINESS_API_TOKEN')
const legacy = JSON.parse(env.get('XIAOWEI_BUSINESS_METRICS_GRANTS') ?? '{}')
const userId = Object.keys(legacy)[0]
if (token === undefined || userId === undefined) throw new Error('acceptance identity or service token unavailable')
const call = async (path, permission, extra = {}) => {
  const response = await fetch(`${origin}${path}`, { headers: {
    authorization: `Bearer ${token}`,
    'x-xiaowei-user-id': userId,
    'x-xiaowei-required-permission': permission,
    ...extra,
  } })
  const body = await response.json()
  if ('count' in body) return { status: response.status, count: body.count }
  if (Array.isArray(body.items)) {
    const safeItems = body.items.every(item => item !== null && typeof item === 'object'
      && Object.keys(item).sort().join(',') === 'maskedEmail,registeredDate'
      && typeof item.maskedEmail === 'string' && item.maskedEmail.includes('***')
      && typeof item.registeredDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.registeredDate))
    const safeEnvelope = Object.keys(body).sort().join(',') === 'hasMore,items,observedAt,page,pageSize'
    return { status: response.status, itemCount: body.items.length, page: body.page, pageSize: body.pageSize, hasMore: body.hasMore, safeItems, safeEnvelope }
  }
  return { status: response.status }
}
const healthResponse = await fetch(`${origin}/health`)
const evidence = {
  health: { status: healthResponse.status },
  registered: await call('/metrics/registered-accounts', 'metrics.accounts.read'),
  consumed: await call('/metrics/share-code-usage', 'metrics.share-codes.read'),
  unused: await call('/metrics/share-code-unused', 'metrics.share-codes.available.read'),
  details: await call('/metrics/registered-user-details', 'users.details.read'),
  wrongBearer: await call('/metrics/registered-accounts', 'metrics.accounts.read', { authorization: 'Bearer acceptance-invalid' }),
  wrongPermission: await call('/metrics/registered-accounts', 'wrong.permission'),
  tenantRejected: await call('/metrics/registered-accounts', 'metrics.accounts.read', { 'x-xiaowei-tenant-id': 'acceptance-tenant' }),
  unknownUser: await call('/metrics/registered-accounts', 'metrics.accounts.read', { 'x-xiaowei-user-id': 'acceptance-unknown-user' }),
}
const expected = Number(expectedUnused)
const detailsExpected = Number(expectedDetails)
if (evidence.registered.status !== 200 || evidence.consumed.status !== 200 || evidence.unused.status !== expected || evidence.details.status !== detailsExpected
  || detailsExpected === 200 && (evidence.details.safeItems !== true || evidence.details.safeEnvelope !== true || evidence.details.pageSize !== 10)
  || evidence.wrongBearer.status !== 401 || evidence.wrongPermission.status !== 403 || evidence.tenantRejected.status !== 403 || evidence.unknownUser.status !== 403) {
  throw new Error(`acceptance probe failed: ${JSON.stringify(evidence)}`)
}
process.stdout.write(`${JSON.stringify(evidence)}\n`)
