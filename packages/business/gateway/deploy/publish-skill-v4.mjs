import { chromium } from '../../../../node_modules/.pnpm/playwright-core@1.62.1/node_modules/playwright-core/index.mjs'

const debugUrl = process.argv[2] ?? 'http://127.0.0.1:9222'
const connection = 'https://business.xiaowei.internal/'
const countOutput = { type: 'object', properties: { count: { type: 'integer' }, observedAt: { type: 'string' } }, required: ['count', 'observedAt'], additionalProperties: false }
const detailOutput = {
  type: 'object',
  properties: {
    items: { type: 'array', items: { type: 'object', properties: { maskedEmail: { type: 'string' }, registeredDate: { type: 'string' } }, required: ['maskedEmail', 'registeredDate'], additionalProperties: false } },
    page: { type: 'integer' }, pageSize: { type: 'integer', const: 10 }, hasMore: { type: 'boolean' }, observedAt: { type: 'string' },
  },
  required: ['items', 'page', 'pageSize', 'hasMore', 'observedAt'], additionalProperties: false,
}
const countInput = { type: 'object', additionalProperties: false }
const detailInput = { type: 'object', properties: { page: { type: 'integer' } }, additionalProperties: false }
const operation = (id, path, permission, input, output, maxResponseBytes) => ({ id, method: 'GET', path, input, output, permission, connection, credentialRef: 'XIAOWEI_BUSINESS_API_TOKEN', risk: 'R1', maxResponseBytes })
const manifest = {
  name: 'xiaowei-business-metrics', version: '1.2.0', description: 'Query registered accounts, registered-user pages, and authenticated-owner share-code metrics.',
  connectionIds: [connection], credentialRefs: ['XIAOWEI_BUSINESS_API_TOKEN'], operations: [
    operation('registered-accounts', '/metrics/registered-accounts', 'metrics.accounts.read', countInput, countOutput, 512),
    operation('share-code-usage', '/metrics/share-code-usage', 'metrics.share-codes.read', countInput, countOutput, 512),
    operation('share-code-unused', '/metrics/share-code-unused', 'metrics.share-codes.available.read', countInput, countOutput, 512),
    operation('registered-user-details', '/metrics/registered-user-details', 'users.details.read', detailInput, detailOutput, 4096),
  ],
}

const browser = await chromium.connectOverCDP(debugUrl)
try {
  const page = browser.contexts()[0]?.pages()[0]
  if (page === undefined) throw new Error('Xiaowei renderer page is unavailable')
  const result = await page.evaluate(async ({ manifestText }) => {
    const api = window.workbenchApi
    const auth = await api.getAuthState()
    if (!auth.signedIn) throw new Error('Xiaowei account is not signed in')
    const before = await api.request('account.businessSkills.list', {})
    const validation = await api.request('account.businessSkills.validate', { manifestText })
    if (!validation.ok || validation.value?.valid !== true) return { signedIn: true, before, validation }
    const publication = await api.request('account.businessSkills.publish', { manifestText, expectedRevision: 3 })
    const after = await api.request('account.businessSkills.list', {})
    return { signedIn: true, before, validation, publication, after }
  }, { manifestText: JSON.stringify(manifest) })
  if (!result.publication?.ok || result.publication.value?.revision !== 4) throw new Error(`Skill publication failed: ${JSON.stringify(result)}`)
  process.stdout.write(`${JSON.stringify({ revision: result.publication.value.revision, version: result.publication.value.manifest.version, operations: result.publication.value.manifest.operations.length })}\n`)
} finally { await browser.close() }
