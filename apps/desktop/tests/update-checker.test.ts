import { beforeEach, describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({ openExternal: vi.fn(async () => undefined) }))
vi.mock('electron', () => ({ shell: { openExternal: electronMocks.openExternal } }))

import { UpdateChecker, compareVersions, platformFileKey } from '../src/main/update-checker'

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function makeChecker(manifest: unknown, options: {
  platform?: NodeJS.Platform
  arch?: string
  open?: (url: string) => Promise<void>
  runInstaller?: (platform: NodeJS.Platform) => Promise<void>
} = {}): { checker: UpdateChecker; fetchImpl: ReturnType<typeof vi.fn> } {
  const fetchImpl = vi.fn(async () => response(manifest))
  const checker = new UpdateChecker({
    baseUrl: () => 'https://xiaowei.example/api',
    currentVersion: '0.3.1',
    onStateChange: vi.fn(),
    fetchImpl: fetchImpl,
    openExternal: options.open,
    runInstaller: options.runInstaller,
    platform: options.platform ?? 'darwin',
    arch: options.arch ?? 'arm64',
  })
  return { checker, fetchImpl }
}

beforeEach(() => { electronMocks.openExternal.mockClear() })

describe('desktop update versions and platform keys', () => {
  it('compares decorated three-segment versions', () => {
    expect(compareVersions('v0.4.0-beta.1', '0.3.1')).toBe(1)
    expect(compareVersions('0.3.1', '0.3.1')).toBe(0)
    expect(compareVersions('0.3', '0.3.1')).toBe(-1)
  })

  it('maps packaged platforms to manifest artifact keys', () => {
    expect(platformFileKey('darwin', 'arm64')).toBe('mac-arm64')
    expect(platformFileKey('darwin', 'x64')).toBe('mac-x64')
    expect(platformFileKey('win32', 'x64')).toBe('win-x64')
    expect(platformFileKey('linux', 'x64')).toBe('linux-x64')
  })
})

describe('UpdateChecker', () => {
  it('finds a platform update and coalesces concurrent checks', async () => {
    const { checker, fetchImpl } = makeChecker({
      version: '0.4.0',
      notes: 'footer account chrome',
      files: { 'mac-arm64': './DeepSeek-Harness-0.4.0-arm64.dmg' },
    })
    const [first, second] = await Promise.all([checker.check(), checker.check()])
    expect(first).toEqual(second)
    expect(first).toMatchObject({
      status: 'available',
      latestVersion: '0.4.0',
      notes: 'footer account chrome',
    })
    expect(first.downloadUrl).toBe('https://xiaowei.example/releases/DeepSeek-Harness-0.4.0-arm64.dmg')
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('reports an invalid release manifest without throwing', async () => {
    const { checker } = makeChecker({ files: {} })
    await expect(checker.check()).resolves.toMatchObject({ status: 'error' })
  })

  it('keeps the update visible when its platform artifact is missing', async () => {
    const { checker } = makeChecker({ version: '0.4.0', files: {} })
    await expect(checker.check()).resolves.toMatchObject({
      status: 'available',
      downloadUrl: undefined,
    })
  })

  it('runs the fixed macOS installer instead of opening the manifest artifact', async () => {
    const sameOrigin = vi.fn(async () => undefined)
    const runInstaller = vi.fn(async () => undefined)
    const { checker } = makeChecker({
      version: '0.4.0',
      files: { 'mac-arm64': './app.dmg' },
    }, { open: sameOrigin, runInstaller })
    await checker.check()
    await checker.openDownload()
    expect(runInstaller).toHaveBeenCalledWith('darwin')
    expect(sameOrigin).not.toHaveBeenCalled()
  })

  it('runs the fixed Windows installer instead of opening the manifest artifact', async () => {
    const open = vi.fn(async () => undefined)
    const runInstaller = vi.fn(async () => undefined)
    const { checker } = makeChecker({
      version: '0.4.0',
      files: { 'win-x64': './app.exe' },
    }, { platform: 'win32', open, runInstaller })
    await checker.check()
    await checker.openDownload()
    expect(runInstaller).toHaveBeenCalledWith('win32')
    expect(open).not.toHaveBeenCalled()
  })

  it('opens only a same-origin Linux artifact', async () => {
    const open = vi.fn(async () => undefined)
    const { checker } = makeChecker({
      version: '0.4.0',
      files: { 'linux-x64': './app.AppImage' },
    }, { platform: 'linux', open })
    await checker.check()
    await checker.openDownload()
    expect(open).toHaveBeenCalledWith('https://xiaowei.example/releases/app.AppImage')

    const other = makeChecker({
      version: '0.4.0',
      files: { 'linux-x64': 'https://downloads.example/app.AppImage' },
    }, { platform: 'linux', open }).checker
    await other.check()
    await expect(other.openDownload()).rejects.toThrow('已拒绝打开')
  })
})
