/** Verify that Electron main-process-only imports are complete inside one packaged app. */
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const appPath = resolve(process.argv[2] ?? '')
if (!appPath || !existsSync(appPath)) {
  throw new Error(`packaged app not found: ${appPath}`)
}

const executable = join(appPath, 'Contents', 'MacOS', '小薇')
const asarPath = join(appPath, 'Contents', 'Resources', 'app.asar')
const imports = [
  '@deepseek-ai/dsh-host-apiproxy/api/account-web.schema',
  '@deepseek-ai/dsh-llm-account-remote/ipc',
  '@deepseek-ai/dsh-web-search-account-remote/ipc',
]
const probe = String.raw`
const { createRequire } = require('node:module')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const asarPath = process.argv[1]
const mainSource = [
  readFileSync(join(asarPath, 'dist/main/main/api-client.js'), 'utf8'),
  readFileSync(join(asarPath, 'dist/main/main/local-runtime-supervisor.js'), 'utf8'),
].join('\n')
for (const rootImport of [
  '@deepseek-ai/dsh-host-apiproxy',
  '@deepseek-ai/dsh-web-search-account-remote',
]) {
  const pattern = new RegExp('from\\s+["\\\']' + rootImport.replaceAll('/', '\\/') + '["\\\']')
  if (pattern.test(mainSource)) throw new Error('forbidden broad main-process import: ' + rootImport)
}
const requireFromApp = createRequire(join(asarPath, 'package.json'))
for (const specifier of JSON.parse(process.argv[2])) requireFromApp(specifier)
console.log('packaged main runtime imports verified')
`

const result = spawnSync(executable, ['-e', probe, asarPath, JSON.stringify(imports)], {
  encoding: 'utf8',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
})
if (result.status !== 0) {
  process.stderr.write(result.stderr)
  throw new Error(`packaged main runtime import probe failed with status ${String(result.status)}`)
}
process.stdout.write(result.stdout)
