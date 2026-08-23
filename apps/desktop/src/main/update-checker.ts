/**
 * Client update checker (方案 A：轻量版本检查 + 浏览器下载安装).
 *
 * The backend statically hosts `releases/latest.json` plus the installer
 * packages (nginx `location /releases/`). The main process polls the manifest,
 * compares it against `app.getVersion()`, and fans state out to the renderer.
 * Downloads are opened in the system browser (`shell.openExternal`) — the mac
 * build is unsigned/unnotarized, so in-app auto-install is not an option.
 *
 * Security discipline: the download URL is resolved from the manifest against
 * the configured backend origin, and `openDownload()` refuses any URL whose
 * origin differs from the current baseUrl origin — the renderer can never
 * smuggle an arbitrary URL into `shell.openExternal` (it passes no URL at all).
 */
import { spawn } from 'node:child_process';
import { shell } from 'electron';
import { z } from 'zod';
import type { AppUpdateState } from '../shared/contracts';

const MANIFEST_PATH = '/releases/latest.json';
const REQUEST_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 4 * 60 * 60 * 1000;
const MAC_INSTALLER_URL = 'https://wgb123-1257121815.cos.ap-beijing.myqcloud.com/install-mac.sh';
const WINDOWS_INSTALLER_URL = 'https://wgb123-1257121815.cos.ap-beijing.myqcloud.com/install-win.bat';

const ReleaseManifestSchema = z.object({
  version: z.string().min(1),
  releasedAt: z.string().optional(),
  notes: z.string().optional(),
  files: z
    .object({
      'mac-arm64': z.string().optional(),
      'mac-x64': z.string().optional(),
      'win-x64': z.string().optional(),
      'linux-x64': z.string().optional()
    })
    .optional()
});

type ReleaseManifest = z.infer<typeof ReleaseManifestSchema>;

export interface UpdateCheckerDeps {
  /** Same source as the ApiClient — follows the service address in credentials. */
  baseUrl: () => string;
  currentVersion: string;
  onStateChange: (state: AppUpdateState) => void;
  /** Test seams — production uses the defaults. */
  fetchImpl?: typeof fetch;
  openExternal?: (url: string) => Promise<void>;
  runInstaller?: (platform: NodeJS.Platform) => Promise<void>;
  platform?: NodeJS.Platform;
  arch?: string;
  pollIntervalMs?: number;
}

/**
 * Minimal semver compare: three numeric segments. A leading `v` and any
 * pre-release/build suffix are stripped; missing segments count as 0.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (raw: string): number[] =>
    raw
      .trim()
      .replace(/^v/i, '')
      .split(/[-+]/, 1)[0]
      .split('.')
      .map((part) => {
        const n = Number.parseInt(part, 10);
        return Number.isFinite(n) ? n : 0;
      });
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

export function platformFileKey(platform: NodeJS.Platform, arch: string): string | null {
  if (platform === 'darwin') return arch === 'arm64' ? 'mac-arm64' : 'mac-x64';
  if (platform === 'win32') return 'win-x64';
  if (platform === 'linux') return 'linux-x64';
  return null;
}

export class UpdateChecker {
  private state: AppUpdateState;
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<AppUpdateState> | null = null;

  constructor(private readonly deps: UpdateCheckerDeps) {
    this.state = { status: 'idle', currentVersion: deps.currentVersion };
  }

  getState(): AppUpdateState {
    return this.state;
  }

  /** Poll immediately, then every 4 hours. */
  start(): void {
    if (this.timer) return;
    void this.check();
    this.timer = setInterval(() => {
      void this.check();
    }, this.deps.pollIntervalMs ?? POLL_INTERVAL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async check(): Promise<AppUpdateState> {
    // 手动点击与定时器可能并发，合并到同一次请求。
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.performCheck().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  /**
   * Start the platform installer. macOS and Windows run the fixed installer
   * scripts in a visible terminal; other platforms retain the download-link
   * behavior. The renderer passes no command or URL into this method.
   */
  async openDownload(): Promise<void> {
    const url = this.state.downloadUrl;
    if (!url) {
      throw new Error('当前平台没有可下载的安装包');
    }
    const platform = this.deps.platform ?? process.platform;
    if (platform === 'darwin' || platform === 'win32') {
      const runInstaller = this.deps.runInstaller ?? ((targetPlatform: NodeJS.Platform) =>
        launchInstallerScript(targetPlatform));
      await runInstaller(platform);
      return;
    }

    let downloadOrigin: string;
    let baseOrigin: string;
    try {
      downloadOrigin = new URL(url).origin;
      baseOrigin = new URL(this.deps.baseUrl()).origin;
    } catch {
      throw new Error('下载地址无效');
    }
    if (downloadOrigin !== baseOrigin) throw new Error('下载地址与服务地址不一致，已拒绝打开');
    const open = this.deps.openExternal ?? ((target: string) => shell.openExternal(target));
    await open(url);
  }

  private async performCheck(): Promise<AppUpdateState> {
    this.transition({ ...this.state, status: 'checking', error: undefined });
    const doFetch = this.deps.fetchImpl ?? fetch;
    try {
      const manifestUrl = new URL(MANIFEST_PATH, this.ensureTrailingSlash(this.deps.baseUrl()));
      const response = await doFetch(manifestUrl, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { accept: 'application/json' }
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const parsed = ReleaseManifestSchema.safeParse(await response.json());
      if (!parsed.success) {
        throw new Error('版本清单格式无效');
      }
      this.transition(this.stateFromManifest(parsed.data, manifestUrl));
    } catch (err) {
      this.transition({
        status: 'error',
        currentVersion: this.deps.currentVersion,
        checkedAt: new Date().toISOString(),
        error: err instanceof Error ? err.message : String(err)
      });
    }
    return this.state;
  }

  private stateFromManifest(manifest: ReleaseManifest, manifestUrl: URL): AppUpdateState {
    const checkedAt = new Date().toISOString();
    const base: AppUpdateState = {
      status: 'up-to-date',
      currentVersion: this.deps.currentVersion,
      latestVersion: manifest.version,
      notes: manifest.notes,
      checkedAt
    };
    if (compareVersions(manifest.version, this.deps.currentVersion) <= 0) {
      return base;
    }
    // 清单缺当前平台文件时仍提示有新版本，但不给下载按钮。
    const fileKey = platformFileKey(this.deps.platform ?? process.platform, this.deps.arch ?? process.arch);
    const relative = fileKey ? manifest.files?.[fileKey as keyof NonNullable<ReleaseManifest['files']>] : undefined;
    const downloadUrl = relative ? new URL(relative, manifestUrl).toString() : undefined;
    return { ...base, status: 'available', downloadUrl };
  }

  private transition(next: AppUpdateState): void {
    const changed = JSON.stringify(next) !== JSON.stringify(this.state);
    this.state = next;
    if (changed) this.deps.onStateChange(next);
  }

  private ensureTrailingSlash(url: string): string {
    return url.endsWith('/') ? url : `${url}/`;
  }
}

function appleScriptString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

function spawnDetached(command: string, args: string[], windowsHide = false): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

/**
 * The script URLs are constants by design: a remote manifest can select the
 * release package, but cannot make the desktop client execute an arbitrary
 * command.
 */
export function launchInstallerScript(platform: NodeJS.Platform): Promise<void> {
  if (platform === 'darwin') {
    const command = `bash -c "$(curl -fsSL ${MAC_INSTALLER_URL})"`;
    return spawnDetached('osascript', [
      '-e',
      `tell application "Terminal" to do script ${appleScriptString(command)}`
    ]);
  }
  if (platform === 'win32') {
    const command = `curl -fsSL -o "%TEMP%\\install-win.bat" ${WINDOWS_INSTALLER_URL} && call "%TEMP%\\install-win.bat"`;
    return spawnDetached('cmd.exe', ['/d', '/s', '/c', command]);
  }
  return Promise.reject(new Error('当前平台不支持脚本安装'));
}
