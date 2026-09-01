import { readFileSync, statSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const [sourceEnvPath, configPath, auditPath, skillDatabasePath] = process.argv.slice(2)
if ([sourceEnvPath, configPath, auditPath, skillDatabasePath].some(value => value === undefined)) {
  throw new Error('usage: final-state-probe.mjs <source-env> <config> <audit> <skill-database>')
}
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
const configText = readFileSync(configPath, 'utf8')
const auditText = readFileSync(auditPath, 'utf8')
const config = JSON.parse(configText)
const token = env.get('XIAOWEI_BUSINESS_API_TOKEN') ?? ''
const rawUsers = Object.keys(JSON.parse(env.get('XIAOWEI_BUSINESS_METRICS_GRANTS') ?? '{}'))
const secretAndRawIdentityAbsent = !configText.includes(token) && !auditText.includes(token) && rawUsers.every(user => !configText.includes(user) && !auditText.includes(user))
const db = new DatabaseSync(skillDatabasePath, { readOnly: true })
const rows = db.prepare('SELECT manifest, revision FROM skill_versions WHERE active = 1').all()
db.close()
const activeSkills = rows.map(row => {
  const manifest = JSON.parse(row.manifest)
  return { name: manifest.name, revision: row.revision, version: manifest.version, operations: manifest.operations.length }
})
process.stdout.write(`${JSON.stringify({
  gatewayRevision: config.revision,
  operationCount: config.operations.length,
  grantCount: config.grants.length,
  subjectHashesValid: config.grants.every(grant => /^[a-f0-9]{64}$/.test(grant.subjectHash)),
  secretAndRawIdentityAbsent,
  auditMode: (statSync(auditPath).mode & 0o777).toString(8),
  activeSkills,
})}\n`)
