/**
 * UpdateChecker unit tests — fetch 全程 mock，不触网、不启动 Electron。
 *
 * 覆盖：有新版本 / 已最新 / 清单缺当前平台文件 / 网络失败 / semver 边界 /
 * openDownload 的平台脚本分流与 origin 白名单校验。
 */
import { describe, expect, it, vi } from 'vitest';
import { UpdateChecker, compareVersions, platformFileKey } from '../src/main/update-checker';
import type { AppUpdateState } from '../src/shared/contracts';

const BASE_URL = 'http://workbench.example.com';

function manifestResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function makeChecker(overrides: {
  manifest?: unknown;
  fetchImpl?: typeof fetch;
  currentVersion?: string;
  platform?: NodeJS.Platform;
  arch?: string;
  onStateChange?: (state: AppUpdateState) => void;
  openExternal?: (url: string) => Promise<void>;
  runInstaller?: (platform: NodeJS.Platform) => Promise<void>;
}) {
  const fetchImpl =
    overrides.fetchImpl ??
    (vi.fn(async () => manifestResponse(overrides.manifest ?? { version: '0.2.0' })) as unknown as typeof fetch);
  const checker = new UpdateChecker({
    baseUrl: () => BASE_URL,
    currentVersion: overrides.currentVersion ?? '0.1.0',
    onStateChange: overrides.onStateChange ?? (() => {}),
    fetchImpl,
    openExternal: overrides.openExternal,
    runInstaller: overrides.runInstaller,
    platform: overrides.platform ?? 'darwin',
    arch: overrides.arch ?? 'arm64'
  });
  return { checker, fetchImpl };
}

describe('compareVersions', () => {
  it('compares numeric segments (0.1.0 < 0.10.0)', () => {
    expect(compareVersions('0.1.0', '0.10.0')).toBe(-1);
    expect(compareVersions('0.10.0', '0.1.0')).toBe(1);
    expect(compareVersions('0.1.0', '0.1.0')).toBe(0);
  });

  it('strips v prefix and pre-release suffix', () => {
    expect(compareVersions('v0.2.0', '0.2.0')).toBe(0);
    expect(compareVersions('0.2.0-beta.1', '0.2.0')).toBe(0);
    expect(compareVersions('0.2', '0.2.0')).toBe(0);
  });
});

describe('platformFileKey', () => {
  it('maps platform/arch to manifest file keys', () => {
    expect(platformFileKey('darwin', 'arm64')).toBe('mac-arm64');
    expect(platformFileKey('darwin', 'x64')).toBe('mac-x64');
    expect(platformFileKey('win32', 'x64')).toBe('win-x64');
    expect(platformFileKey('linux', 'x64')).toBe('linux-x64');
  });
});

describe('UpdateChecker.check', () => {
  it('reports available with a resolved download URL when the manifest is newer', async () => {
    const states: AppUpdateState[] = [];
    const { checker, fetchImpl } = makeChecker({
      manifest: {
        version: '0.2.0',
        notes: '修复若干问题',
        files: { 'mac-arm64': './Enterprise AI Workbench-0.2.0-arm64.dmg' }
      },
      onStateChange: (s) => states.push(s)
    });

    const state = await checker.check();

    expect(state.status).toBe('available');
    expect(state.latestVersion).toBe('0.2.0');
    expect(state.notes).toBe('修复若干问题');
    // 相对路径基于清单 URL 解析；文件名含空格时百分号编码。
    expect(state.downloadUrl).toBe(
      'http://workbench.example.com/releases/Enterprise%20AI%20Workbench-0.2.0-arm64.dmg'
    );
    expect(vi.mocked(fetchImpl)).toHaveBeenCalledOnce();
    // 状态变化才推送：checking → available，共 2 次。
    expect(states.map((s) => s.status)).toEqual(['checking', 'available']);
  });

  it('reports up-to-date when the manifest version is not newer', async () => {
    const { checker } = makeChecker({ manifest: { version: '0.1.0' } });
    const state = await checker.check();
    expect(state.status).toBe('up-to-date');
    expect(state.downloadUrl).toBeUndefined();
  });

  it('treats v-prefixed manifest versions as equal to the current version', async () => {
    const { checker } = makeChecker({ manifest: { version: 'v0.1.0' } });
    const state = await checker.check();
    expect(state.status).toBe('up-to-date');
  });

  it('reports available without downloadUrl when the manifest lacks a file for this platform', async () => {
    const { checker } = makeChecker({
      manifest: { version: '0.2.0', files: { 'win-x64': './setup.exe' } },
      platform: 'darwin',
      arch: 'arm64'
    });
    const state = await checker.check();
    expect(state.status).toBe('available');
    expect(state.downloadUrl).toBeUndefined();
  });

  it('enters error state (without throwing) on network failure', async () => {
    const failingFetch = vi.fn(async () => {
      throw new Error('connection refused');
    }) as unknown as typeof fetch;
    const { checker } = makeChecker({ fetchImpl: failingFetch });
    const state = await checker.check();
    expect(state.status).toBe('error');
    expect(state.error).toContain('connection refused');
  });

  it('enters error state on non-200 responses and invalid manifests', async () => {
    const notFound = vi.fn(async () => manifestResponse({}, 404)) as unknown as typeof fetch;
    expect((await makeChecker({ fetchImpl: notFound }).checker.check()).status).toBe('error');

    const invalid = vi.fn(async () => manifestResponse({ nope: true })) as unknown as typeof fetch;
    expect((await makeChecker({ fetchImpl: invalid }).checker.check()).status).toBe('error');
  });

  it('coalesces concurrent checks into one request', async () => {
    const { checker, fetchImpl } = makeChecker({ manifest: { version: '0.2.0' } });
    const [a, b] = await Promise.all([checker.check(), checker.check()]);
    expect(a).toEqual(b);
    expect(vi.mocked(fetchImpl)).toHaveBeenCalledOnce();
  });
});

describe('UpdateChecker.openDownload', () => {
  async function checkerWithUpdate(
    openExternal: (url: string) => Promise<void>,
    runInstaller?: (platform: NodeJS.Platform) => Promise<void>,
    platform: NodeJS.Platform = 'darwin'
  ) {
    const { checker } = makeChecker({
      manifest: { version: '0.2.0', files: { 'mac-arm64': './app.dmg' } },
      openExternal,
      runInstaller,
      platform
    });
    await checker.check();
    return checker;
  }

  it('runs the macOS installer script instead of opening the package URL', async () => {
    const openExternal = vi.fn(async () => {});
    const runInstaller = vi.fn(async () => {});
    const checker = await checkerWithUpdate(openExternal, runInstaller);
    await checker.openDownload();
    expect(runInstaller).toHaveBeenCalledWith('darwin');
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('runs the Windows installer script on win32', async () => {
    const openExternal = vi.fn(async () => {});
    const runInstaller = vi.fn(async () => {});
    const { checker } = makeChecker({
      manifest: { version: '0.2.0', files: { 'win-x64': './app.exe' } },
      platform: 'win32',
      runInstaller,
      openExternal
    });
    await checker.check();
    await checker.openDownload();
    expect(runInstaller).toHaveBeenCalledWith('win32');
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('refuses Linux download URLs whose origin differs from the backend', async () => {
    const openExternal = vi.fn(async () => {});
    const { checker } = makeChecker({
      // 清单里的绝对 URL 指向其它源 —— 必须被拒绝。
      manifest: { version: '0.2.0', files: { 'linux-x64': 'https://evil.example.com/app.dmg' } },
      platform: 'linux',
      openExternal
    });
    await checker.check();
    await expect(checker.openDownload()).rejects.toThrow('已拒绝打开');
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('refuses when there is no update artifact for this platform', async () => {
    const openExternal = vi.fn(async () => {});
    const { checker } = makeChecker({ manifest: { version: '0.2.0' }, openExternal });
    await checker.check();
    await expect(checker.openDownload()).rejects.toThrow('没有可下载的安装包');
    expect(openExternal).not.toHaveBeenCalled();
  });
});
