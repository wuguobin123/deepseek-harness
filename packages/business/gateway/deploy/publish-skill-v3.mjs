import { chromium } from '../../../../node_modules/.pnpm/playwright-core@1.62.1/node_modules/playwright-core/index.mjs'

const debugUrl = process.argv[2] ?? 'http://127.0.0.1:9222'
const connection = 'https://business.xiaowei.internal/'
const output = {
  type: 'object',
  properties: { count: { type: 'integer' }, observedAt: { type: 'string' } },
  required: ['count', 'observedAt'],
  additionalProperties: false,
}
const operation = (id, path, permission) => ({
  id,
  method: 'GET',
  path,
  input: { type: 'object', additionalProperties: false },
  output,
  permission,
  connection,
  credentialRef: 'XIAOWEI_BUSINESS_API_TOKEN',
  risk: 'R1',
  maxResponseBytes: 4096,
})
const manifest = {
  name: 'xiaowei-business-metrics',
  version: '1.1.0',
  description: 'Query registered accounts and authenticated-owner share-code metrics.',
  connectionIds: [connection],
  credentialRefs: ['XIAOWEI_BUSINESS_API_TOKEN'],
  operations: [
    operation('registered-accounts', '/metrics/registered-accounts', 'metrics.accounts.read'),
    operation('share-code-usage', '/metrics/share-code-usage', 'metrics.share-codes.read'),
    operation('share-code-unused', '/metrics/share-code-unused', 'metrics.share-codes.available.read'),
  ],
}

const browser = await chromium.connectOverCDP(debugUrl)
try {
  const context = browser.contexts()[0]
  const page = context?.pages()[0]
  if (page === undefined) throw new Error('Xiaowei renderer page is unavailable')
  const result = await page.evaluate(async ({ manifestText }) => {
    const api = window.workbenchApi
    const auth = await api.getAuthState()
    if (!auth.signedIn) throw new Error('Xiaowei account is not signed in')
    const before = await api.request('account.businessSkills.list', {})
    const validation = await api.request('account.businessSkills.validate', { manifestText })
    if (!validation.ok || typeof validation.value !== 'object' || validation.value === null || !('valid' in validation.value) || validation.value.valid !== true) {
      return { signedIn: true, before, validation }
    }
    const publication = await api.request('account.businessSkills.publish', { manifestText, expectedRevision: 2 })
    const after = await api.request('account.businessSkills.list', {})
    return { signedIn: true, before, validation, publication, after }
  }, { manifestText: JSON.stringify(manifest) })
  const summarize = value => {
    if (value === null || typeof value !== 'object' || !('ok' in value)) return { ok: false }
    if (!value.ok) return { ok: false, code: value.error?.code ?? 'unknown' }
    if (value.value !== null && typeof value.value === 'object' && 'items' in value.value) {
      return { ok: true, revisions: value.value.items.map(item => ({ revision: item.revision, active: item.active, version: item.manifest.version, operations: item.manifest.operations.length })) }
    }
    if (value.value !== null && typeof value.value === 'object' && 'revision' in value.value) {
      return { ok: true, revision: value.value.revision, active: value.value.active, version: value.value.manifest.version, operations: value.value.manifest.operations.length }
    }
    return { ok: true, value: value.value }
  }
  const evidence = {
    signedIn: result.signedIn,
    before: summarize(result.before),
    validation: summarize(result.validation),
    publication: summarize(result.publication),
    after: summarize(result.after),
  }
  if (!evidence.publication.ok || evidence.publication.revision !== 3 || evidence.publication.operations !== 3) throw new Error(`Skill publication failed: ${JSON.stringify(evidence)}`)
  process.stdout.write(`${JSON.stringify(evidence)}\n`)
} finally {
  await browser.close()
}
