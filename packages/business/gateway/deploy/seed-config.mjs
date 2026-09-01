import { createHash } from 'node:crypto'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'

const [sourceEnvPath, configPath, gatewayEnvPath, mode = 'initial'] = process.argv.slice(2)
if (sourceEnvPath === undefined || configPath === undefined || gatewayEnvPath === undefined) {
  throw new Error('usage: seed-config.mjs <source-env> <config> <gateway-env> [initial|with-unused|with-user-details]')
}
if (mode !== 'initial' && mode !== 'with-unused' && mode !== 'with-user-details') throw new Error('mode must be initial, with-unused, or with-user-details')

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
const rawGrants = env.get('XIAOWEI_BUSINESS_METRICS_GRANTS')
if (typeof token !== 'string' || token.length < 32 || /[\r\n]/.test(token)) throw new Error('business API token is unavailable or unsafe for EnvironmentFile')
if (typeof rawGrants !== 'string') throw new Error('business metric grants are unavailable')
const legacyGrants = JSON.parse(rawGrants)
if (legacyGrants === null || Array.isArray(legacyGrants) || typeof legacyGrants !== 'object') throw new Error('business metric grants must be an object')

const includeUnused = mode === 'with-unused' || mode === 'with-user-details'
const includeUserDetails = mode === 'with-user-details'
const operations = [
  { id: 'registered-accounts', path: '/metrics/registered-accounts', provider: 'xiaowei-identity', action: 'registered-account-count', permission: 'metrics.accounts.read', ownerScoped: false },
  { id: 'share-code-usage', path: '/metrics/share-code-usage', provider: 'xiaowei-identity', action: 'consumed-invitation-count', permission: 'metrics.share-codes.read', ownerScoped: true },
]
if (includeUnused) operations.push({ id: 'share-code-unused', path: '/metrics/share-code-unused', provider: 'xiaowei-identity', action: 'unconsumed-invitation-count', permission: 'metrics.share-codes.available.read', ownerScoped: true })
if (includeUserDetails) operations.push({ id: 'registered-user-details', path: '/metrics/registered-user-details', provider: 'xiaowei-identity', action: 'registered-user-page', permission: 'users.details.read', ownerScoped: false })
const grants = Object.entries(legacyGrants).map(([userId, permissions]) => {
  if (!Array.isArray(permissions) || permissions.some(permission => typeof permission !== 'string')) throw new Error('business metric grant permissions are invalid')
  return {
    subjectHash: createHash('sha256').update(userId).digest('hex'),
    permissions: [...new Set([
      ...permissions,
      ...(includeUnused && permissions.includes('metrics.share-codes.read') ? ['metrics.share-codes.available.read'] : []),
      ...(includeUserDetails && permissions.includes('metrics.accounts.read') ? ['users.details.read'] : []),
    ])],
  }
})
const config = { revision: includeUserDetails ? 3 : includeUnused ? 2 : 1, operations, grants }
const stagedConfig = `${configPath}.next`
const stagedEnv = `${gatewayEnvPath}.next`
writeFileSync(stagedConfig, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
writeFileSync(stagedEnv, `XIAOWEI_BUSINESS_API_TOKEN=${token}\n`, { mode: 0o600 })
renameSync(stagedConfig, configPath)
renameSync(stagedEnv, gatewayEnvPath)
process.stdout.write(JSON.stringify({ revision: config.revision, operationCount: operations.length, grantCount: grants.length }) + '\n')
