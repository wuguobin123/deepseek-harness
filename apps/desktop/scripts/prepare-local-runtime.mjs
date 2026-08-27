/** Build a self-contained production dsh tree for the packaged local runtime. */

import { spawnSync } from 'node:child_process'
import {
  chmodSync, existsSync, lstatSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'

const root = resolve(import.meta.dirname, '../../..')
const output = resolve(import.meta.dirname, '../dist/local-runtime')
const options = Object.fromEntries(process.argv.slice(2).filter(argument => argument !== '--').map((argument) => {
  const match = /^--([^=]+)=(.+)$/.exec(argument)
  if (match === null) throw new Error(`unknown local-runtime option: ${argument}`)
  return [match[1], match[2]]
}))
const targetPlatform = options.platform ?? process.platform
const targetArch = options.arch ?? process.arch
const targetLibc = options.libc ?? (targetPlatform === 'linux' ? 'glibc' : undefined)
if (!['darwin', 'linux', 'win32'].includes(targetPlatform)) {
  throw new Error(`unsupported local-runtime platform: ${targetPlatform}`)
}
if (!['arm64', 'x64'].includes(targetArch)) {
  throw new Error(`unsupported local-runtime architecture: ${targetArch}`)
}
if (targetPlatform === 'linux' && !['glibc', 'musl'].includes(targetLibc)) {
  throw new Error(`unsupported local-runtime libc: ${String(targetLibc)}`)
}
const pnpmStateFiles = [
  join(root, 'node_modules/.modules.yaml'),
  join(root, 'node_modules/.pnpm/lock.yaml'),
  join(root, 'node_modules/.pnpm-workspace-state-v1.json'),
]
const pnpmState = new Map(pnpmStateFiles.flatMap(path => existsSync(path) ? [[path, readFileSync(path)]] : []))

rmSync(output, { recursive: true, force: true })
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const deploy = spawnSync(pnpm, [
  '--offline',
  '--ignore-scripts',
  '--config.inject-workspace-packages=true',
  '--filter',
  '@deepseek-ai/dsh-xiaowei-device-runtime',
  'deploy',
  '--prod',
  output,
], { cwd: root, env: { ...process.env, CI: 'true' }, stdio: 'inherit' })

for (const [path, contents] of pnpmState) writeFileSync(path, contents)
if (deploy.error !== undefined) throw deploy.error
if (deploy.status !== 0) throw new Error(`local runtime deploy exited with ${String(deploy.status ?? deploy.signal)}`)

const virtualStore = join(output, 'node_modules/.pnpm')
const runtimeManifest = join(output, 'package.json')
const subprocessManifest = createRequire(realpathSync(runtimeManifest)).resolve('@deepseek-ai/dsh-subprocess-local/package.json')
const subprocessRoot = dirname(subprocessManifest)
const ptyManifest = createRequire(realpathSync(subprocessManifest)).resolve('node-pty/package.json')
const ptyRoot = dirname(ptyManifest)

/** Return whether one pnpm package key belongs to another platform or CPU architecture. */
function isWrongPlatformPackage(key) {
  const nativeTarget = /-(darwin|linux|linuxmusl|win32)-(arm64|x64)(?=@|_|\+|-|$)/.exec(key)
  if (nativeTarget !== null) {
    const platform = nativeTarget[1] === 'linuxmusl' ? 'linux' : nativeTarget[1]
    const libc = nativeTarget[1] === 'linuxmusl' ? 'musl' : platform === 'linux' ? 'glibc' : undefined
    return platform !== targetPlatform
      || nativeTarget[2] !== targetArch
      || (platform === 'linux' && libc !== targetLibc)
  }
  if (key.includes('-darwin-')) return targetPlatform !== 'darwin'
  if (key.includes('-win32-')) return targetPlatform !== 'win32'
  if (key.includes('-linux-') || key.includes('-linuxmusl-')) return targetPlatform !== 'linux'
  return false
}

for (const key of readdirSync(virtualStore)) {
  if (isWrongPlatformPackage(key) || key.startsWith('@types+')) {
    rmSync(join(virtualStore, key), { recursive: true, force: true })
  }
}

const ptyPrebuilds = join(ptyRoot, 'prebuilds')
for (const entry of readdirSync(ptyPrebuilds, { withFileTypes: true })) {
  if (entry.isDirectory() && entry.name !== `${targetPlatform}-${targetArch}`) {
    rmSync(join(ptyPrebuilds, entry.name), { recursive: true, force: true })
  }
}

// node-pty ships Windows' OpenConsole binaries outside `prebuilds/`. They are
// runtime assets on Windows, but dead weight on macOS/Linux; on Windows retain
// only the directory for the packaged CPU architecture.
const ptyConpty = join(ptyRoot, 'third_party', 'conpty')
if (existsSync(ptyConpty)) {
  if (targetPlatform !== 'win32') {
    rmSync(ptyConpty, { recursive: true, force: true })
  } else {
    for (const entry of readdirSync(ptyConpty, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith('win10-') && entry.name !== `win10-${targetArch}`) {
        rmSync(join(ptyConpty, entry.name), { recursive: true, force: true })
      }
    }
  }
}

/** Remove build-only declarations and maps from the executable resource tree. */
function removeBuildOnlyFiles(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      removeBuildOnlyFiles(child)
      continue
    }
    if (entry.name.endsWith('.d.ts')
      || entry.name.endsWith('.d.ts.map')
      || entry.name.endsWith('.js.map')
      || entry.name.endsWith('.tsbuildinfo')) {
      rmSync(child, { force: true })
    }
  }
}
removeBuildOnlyFiles(output)

/** Remove pnpm dependency links whose platform package was pruned. */
function removeDanglingLinks(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name)
    if (entry.isSymbolicLink()) {
      if (!existsSync(child)) rmSync(child, { force: true })
      continue
    }
    if (entry.isDirectory()) removeDanglingLinks(child)
  }
}
removeDanglingLinks(output)

const forbidden = readdirSync(virtualStore).filter(key =>
  /^@deepseek-ai\+dsh@/.test(key)
  || key.includes('@deepseek-ai+dsh-web-frontend@')
  || key.includes('@deepseek-ai+dsh-account-')
  || /@deepseek-ai\+dsh-(?:[^@+]+-)?e2b@/.test(key)
  || key.includes('@deepseek-ai+dsh-session-telemetry')
  || isWrongPlatformPackage(key),
)
if (forbidden.length > 0) {
  throw new Error(`local runtime contains forbidden packages:\n${forbidden.sort().join('\n')}`)
}

const packageKeys = readdirSync(virtualStore)
const requiredNativeFragments = [
  `@vscode+ripgrep-${targetPlatform}-${targetArch}@`,
  `@koromix+koffi-${targetPlatform}-${targetArch}@`,
  `@img+sharp-${targetPlatform}-${targetArch}@`,
  `node-addon-require-builtin-${targetPlatform}-${targetArch}`,
]
if (targetPlatform === 'darwin') requiredNativeFragments.push(`@img+sharp-libvips-darwin-${targetArch}@`)
if (targetPlatform === 'linux') {
  requiredNativeFragments.push(
    `@img+sharp-libvips-${targetLibc === 'musl' ? 'linuxmusl' : 'linux'}-${targetArch}@`,
    `@deepseek-ai+node-addon-landlock-run-linux-${targetArch}@`,
  )
}
const missingNative = requiredNativeFragments.filter(fragment => !packageKeys.some(key => key.includes(fragment)))
if (missingNative.length > 0) {
  throw new Error(`local runtime is missing ${targetPlatform}-${targetArch} native packages:\n${missingNative.join('\n')}`)
}
const ptyTarget = join(ptyPrebuilds, `${targetPlatform}-${targetArch}`)
if (!existsSync(ptyTarget)) {
  throw new Error(`local runtime is missing node-pty prebuilds for ${targetPlatform}-${targetArch}`)
}

/** Count regular-file bytes without following package-manager links. */
function treeBytes(path) {
  const stat = lstatSync(path)
  if (stat.isSymbolicLink()) return 0
  if (!stat.isDirectory()) return stat.size
  return readdirSync(path).reduce((total, name) => total + treeBytes(join(path, name)), 0)
}

const packages = readdirSync(virtualStore)
  .filter(key => key !== 'lock.yaml')
  .map(key => ({ packageKey: key, bytes: treeBytes(join(virtualStore, key)) }))
  .sort((left, right) => right.bytes - left.bytes || left.packageKey.localeCompare(right.packageKey))
const ledger = {
  generatedAt: new Date().toISOString(),
  platform: targetPlatform,
  arch: targetArch,
  ...(targetLibc === undefined ? {} : { libc: targetLibc }),
  totalBytes: packages.reduce((total, item) => total + item.bytes, 0),
  packages,
}
writeFileSync(join(output, 'local-runtime-size-ledger.json'), `${JSON.stringify(ledger, null, 2)}\n`)

for (const candidate of [
  join(ptyRoot, 'prebuilds', `${targetPlatform}-${targetArch}`, 'spawn-helper'),
  join(ptyRoot, 'build', 'Release', 'spawn-helper'),
]) {
  if (existsSync(candidate)) chmodSync(candidate, 0o755)
}

if (!existsSync(join(output, 'bin', 'xiaowei-device-runtime.mjs'))
  || !existsSync(join(subprocessRoot, 'lib/index.js'))
  || !existsSync(join(output, 'local-runtime-size-ledger.json'))) {
  throw new Error('local runtime deploy did not produce the required executable closure')
}
