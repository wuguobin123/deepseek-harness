/** Poll a release manifest and launch the fixed installer for the current platform. */
import { spawn } from 'node:child_process'
import { shell } from 'electron'
import { z } from 'zod'
import type { AppUpdateState } from '../shared/contracts'

const MANIFEST_PATH = '/releases/latest.json'
const REQUEST_TIMEOUT_MS = 10_000
const POLL_INTERVAL_MS = 4 * 60 * 60 * 1000
const MAC_INSTALLER_URL = 'https://wgb123-1257121815.cos.ap-beijing.myqcloud.com/install-mac.sh'
const WINDOWS_INSTALLER_URL = 'https://wgb123-1257121815.cos.ap-beijing.myqcloud.com/install-win.bat'

const ReleaseManifestSchema = z.object({
  version: z.string().min(1),
  releasedAt: z.string().optional(),
  notes: z.string().optional(),
  files: z.object({
    'mac-arm64': z.string().optional(),
    'mac-x64': z.string().optional(),
    'win-x64': z.string().optional(),
    'linux-x64': z.string().optional(),
  }).optional(),
})

type ReleaseManifest = z.infer<typeof ReleaseManifestSchema>

export interface UpdateCheckerDeps {
  /** Same mutable service address used by the API client. */
  baseUrl: () => string
  currentVersion: string
  onStateChange: (state: AppUpdateState) => void
  fetchImpl?: typeof fetch
  openExternal?: (url: string) => Promise<void>
  runInstaller?: (platform: NodeJS.Platform) => Promise<void>
  platform?: NodeJS.Platform
  arch?: string
  pollIntervalMs?: number
}

/** Compare three numeric version segments after stripping common decorations. */
export function compareVersions(a: string, b: string): number {
  const parse = (raw: string): number[] => raw
    .trim()
    .replace(/^v/i, '')
    .split(/[-+]/, 1)[0]
    .split('.')
    .map((part) => {
      const value = Number.parseInt(part, 10)
      return Number.isFinite(value) ? value : 0
    })
  const left = parse(a)
  const right = parse(b)
  for (let index = 0; index < 3; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0)
    if (difference !== 0) return difference < 0 ? -1 : 1
  }
  return 0
}

/** Resolve the release-manifest artifact key for one packaged client. */
export function platformFileKey(platform: NodeJS.Platform, arch: string): keyof NonNullable<ReleaseManifest['files']> | null {
  if (platform === 'darwin') return arch === 'arm64' ? 'mac-arm64' : 'mac-x64'
  if (platform === 'win32') return 'win-x64'
  if (platform === 'linux') return 'linux-x64'
  return null
}

/** Main-process update checker with one coalesced request and bounded polling. */
export class UpdateChecker {
  private state: AppUpdateState
  private timer: NodeJS.Timeout | null = null
  private inFlight: Promise<AppUpdateState> | null = null

  constructor(private readonly deps: UpdateCheckerDeps) {
    this.state = { status: 'idle', currentVersion: deps.currentVersion }
  }

  getState(): AppUpdateState {
    return this.state
  }

  /** Check immediately, then repeat on the configured interval. */
  start(): void {
    if (this.timer) return
    void this.check()
    this.timer = setInterval(() => { void this.check() }, this.deps.pollIntervalMs ?? POLL_INTERVAL_MS)
    this.timer.unref()
  }

  stop(): void {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = null
  }

  async check(): Promise<AppUpdateState> {
    if (this.inFlight) return this.inFlight
    this.inFlight = this.performCheck().finally(() => { this.inFlight = null })
    return this.inFlight
  }

  /** Launch the fixed macOS or Windows installer; other platforms open a validated package URL. */
  async openDownload(): Promise<void> {
    const downloadUrl = this.state.downloadUrl
    if (!downloadUrl) throw new Error('当前平台没有可下载的安装包')
    const platform = this.deps.platform ?? process.platform
    if (platform === 'darwin' || platform === 'win32') {
      const runInstaller = this.deps.runInstaller ?? launchInstallerScript
      await runInstaller(platform)
      return
    }
    let downloadOrigin: string
    let baseOrigin: string
    try {
      downloadOrigin = new URL(downloadUrl).origin
      baseOrigin = new URL(this.deps.baseUrl()).origin
    } catch {
      throw new Error('下载地址无效')
    }
    if (downloadOrigin !== baseOrigin) throw new Error('下载地址与服务地址不一致，已拒绝打开')
    const open = this.deps.openExternal ?? ((target: string) => shell.openExternal(target))
    await open(downloadUrl)
  }

  private async performCheck(): Promise<AppUpdateState> {
    this.transition({ ...this.state, status: 'checking', error: undefined })
    try {
      const manifestUrl = new URL(MANIFEST_PATH, this.withTrailingSlash(this.deps.baseUrl()))
      const response = await (this.deps.fetchImpl ?? fetch)(manifestUrl, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { accept: 'application/json' },
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const parsed = ReleaseManifestSchema.safeParse(await response.json())
      if (!parsed.success) throw new Error('版本清单格式无效')
      this.transition(this.fromManifest(parsed.data, manifestUrl))
    } catch (error) {
      this.transition({
        status: 'error',
        currentVersion: this.deps.currentVersion,
        checkedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      })
    }
    return this.state
  }

  private fromManifest(manifest: ReleaseManifest, manifestUrl: URL): AppUpdateState {
    const base: AppUpdateState = {
      status: 'up-to-date',
      currentVersion: this.deps.currentVersion,
      latestVersion: manifest.version,
      notes: manifest.notes,
      checkedAt: new Date().toISOString(),
    }
    if (compareVersions(manifest.version, this.deps.currentVersion) <= 0) return base
    const key = platformFileKey(this.deps.platform ?? process.platform, this.deps.arch ?? process.arch)
    const relative = key ? manifest.files?.[key] : undefined
    const downloadUrl = relative ? new URL(relative, manifestUrl).toString() : undefined
    return { ...base, status: 'available', downloadUrl }
  }

  private transition(next: AppUpdateState): void {
    const changed = JSON.stringify(next) !== JSON.stringify(this.state)
    this.state = next
    if (changed) this.deps.onStateChange(next)
  }

  private withTrailingSlash(value: string): string {
    return value.endsWith('/') ? value : `${value}/`
  }
}

function appleScriptString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`
}

function spawnDetached(command: string, args: string[], windowsHide = false): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide,
    })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

/**
 * Launch one visible, fixed installer command without accepting renderer or manifest input.
 * @param platform - Packaged client platform selected by the main process.
 * @returns A promise that resolves after the detached installer terminal starts.
 */
export function launchInstallerScript(platform: NodeJS.Platform): Promise<void> {
  if (platform === 'darwin') {
    const command = `bash -c "$(curl -fsSL ${MAC_INSTALLER_URL})"`
    return spawnDetached('osascript', [
      '-e',
      `tell application "Terminal" to do script ${appleScriptString(command)}`,
    ])
  }
  if (platform === 'win32') {
    const command = `curl -fsSL -o "%TEMP%\\install-win.bat" ${WINDOWS_INSTALLER_URL} && call "%TEMP%\\install-win.bat"`
    return spawnDetached('cmd.exe', ['/d', '/s', '/c', command])
  }
  return Promise.reject(new Error('当前平台不支持脚本安装'))
}
