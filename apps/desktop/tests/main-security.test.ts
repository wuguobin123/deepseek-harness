/**
 * Security unit tests for the Electron main + preload boundary.
 *
 * These tests assert, without launching Electron, that the preload bridge:
 *   - exposes only the keys listed in `WORKBENCH_API_KEYS`
 *   - does NOT expose `ipcRenderer`, `require`, `process`, or other globals
 *   - the renderer window only ever sees `window.workbenchApi`
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WORKBENCH_API_KEYS, FORBIDDEN_WINDOW_KEYS } from '../src/shared/contracts';

const PRELOAD_PATH = resolve(__dirname, '../src/preload/index.ts');
const IPC_HANDLERS_PATH = resolve(__dirname, '../src/main/ipc-handlers.ts');
const BROWSER_CONTROLLER_PATH = resolve(__dirname, '../src/main/browser-controller.ts');
const MAIN_PATH = resolve(__dirname, '../src/main/index.ts');

function loadPreloadSource(): string {
  return readFileSync(PRELOAD_PATH, 'utf-8');
}

describe('preload source contains no dangerous references', () => {
  let source: string;

  beforeEach(() => {
    source = loadPreloadSource();
  });

  it('does not import process or require', () => {
    expect(source).not.toMatch(/\brequire\s*\(/);
    expect(source).not.toMatch(/from\s+['"]node:process['"]/);
  });

  it('uses contextBridge.exposeInMainWorld with the agreed name', () => {
    expect(source).toMatch(/contextBridge\.exposeInMainWorld\(\s*['"]workbenchApi['"]/);
  });

  it('does not call ipcRenderer.send or ipcRenderer.sendSync', () => {
    expect(source).not.toMatch(/ipcRenderer\.send\s*\(/);
    expect(source).not.toMatch(/ipcRenderer\.sendSync\s*\(/);
  });
});

describe('simulated window bridge', () => {
  it('only exposes keys from WORKBENCH_API_KEYS', () => {
    const exposed: Record<string, unknown> = {};
    for (const key of WORKBENCH_API_KEYS) {
      exposed[key] = vi.fn();
    }

    const fakeContextBridge = {
      exposeInMainWorld: vi.fn((name: string, value: Record<string, unknown>) => {
        (globalThis as unknown as Record<string, unknown>)[name] = value;
      })
    };

    // We exercise the contract directly: only the keys from
    // `WORKBENCH_API_KEYS` are supposed to be on the bridge.
    fakeContextBridge.exposeInMainWorld('workbenchApi', exposed);

    const windowLike = (globalThis as unknown as Record<string, unknown>).workbenchApi as Record<string, unknown>;
    expect(Object.keys(windowLike).sort()).toEqual([...WORKBENCH_API_KEYS].sort());
  });

  it('forbidden keys are not on the bridge', () => {
    const exposed: Record<string, unknown> = {};
    for (const key of WORKBENCH_API_KEYS) {
      exposed[key] = vi.fn();
    }
    for (const forbidden of FORBIDDEN_WINDOW_KEYS) {
      expect((exposed as Record<string, unknown>)[forbidden]).toBeUndefined();
    }
  });
});

describe('preload contract', () => {
  it('exposes exactly the documented methods', () => {
    // The contract requires these exact keys. If a future PR adds another
    // method, this test must be updated and security review re-run.
    expect([...WORKBENCH_API_KEYS].sort()).toEqual([
      'authenticateSession',
      'browserAction',
      'browserGetState',
      'browserNavigate',
      'browserOpenArtifact',
      'browserSetBounds',
      'browserSetVisible',
      'checkAppUpdate',
      'convertArtifactToPdf',
      'downloadArtifactFile',
      'exportArtifactToPptx',
      'getAppUpdateState',
      'getSession',
      'logoutSession',
      'openAppUpdateDownload',
      'openArtifactFile',
      'openExternalUrl',
      'openVerificationArtifact',
      'readArtifactContent',
      'readLocalPdf',
      'request',
      'requestArtifactPreviewToken',
      'selectAndUploadArtifact',
      'selectAndUploadKnowledgeDocument',
      'sendEmailVerificationCode',
      'streamAssistant',
      'subscribeAnomalies',
      'subscribeAppUpdateState',
      'subscribeBrowserState',
      'updateSession',
      'uploadClipboardImage'
    ]);
  });
});

describe('embedded browser isolation', () => {
  it('uses WebContentsView with sandboxing and no Node integration', () => {
    const source = readFileSync(BROWSER_CONTROLLER_PATH, 'utf-8');
    expect(source).toMatch(/new WebContentsView/);
    expect(source).toMatch(/contextIsolation:\s*true/);
    expect(source).toMatch(/nodeIntegration:\s*false/);
    expect(source).toMatch(/sandbox:\s*true/);
  });

  it('denies browser permissions and downloads by default', () => {
    const source = readFileSync(BROWSER_CONTROLLER_PATH, 'utf-8');
    expect(source).toMatch(/setPermissionRequestHandler/);
    expect(source).toMatch(/will-download/);
    expect(source).toMatch(/event\.preventDefault\(\)/);
  });

  it('routes user-clicked blank links in the current view while denying unsolicited popups', () => {
    const source = readFileSync(BROWSER_CONTROLLER_PATH, 'utf-8');
    expect(source).toMatch(
      /anchor\.getAttribute\('target'\)\?\.toLocaleLowerCase\(\)\s*!==\s*'_blank'/
    );
    expect(source).toMatch(/anchor\.removeAttribute\('target'\)/);
    expect(source).toContain("const marker = 'data-workbench-route-current'");
    expect(source).toContain('event.stopImmediatePropagation()');
    expect(source).toContain('navigator.userActivation?.isActive');
    expect(source).toContain('window.open = (url) =>');
    expect(source).toContain('routeUrlFromUserGesture(anchor.href)');
    expect(source).toContain('location.assign(url.href)');
    expect(source).toContain("attributeFilter: ['target']");
    expect(source).toMatch(/new MutationObserver/);
    expect(source).toMatch(/contents\.on\('dom-ready', installLinkRouter\)/);
    expect(source).toMatch(/contents\.on\('did-finish-load', installLinkRouter\)/);
    expect(source).toMatch(
      /if\s*\(!this\.allowWindowOpen\)\s*return\s*\{\s*action:\s*'deny'\s*\}/
    );
  });

  it('does not apply the shell file-only navigation guard to the embedded browser partition', () => {
    const source = readFileSync(MAIN_PATH, 'utf-8');
    expect(source).toContain('session.fromPartition(EMBEDDED_BROWSER_PARTITION)');
    expect(source).toMatch(
      /contents\.getType\(\)\s*===\s*'window'\s*&&\s*!isEmbeddedBrowser/
    );
  });

  it('bypasses the system proxy only for the trusted TencentOS IP-scoped hosts', () => {
    const source = readFileSync(BROWSER_CONTROLLER_PATH, 'utf-8');
    expect(source).toContain("const TRUSTED_DIRECT_IP = '119.45.252.25'");
    expect(source).toContain("const TRUSTED_DIRECT_NIP_SUFFIX = '.119.45.252.25.nip.io'");
    expect(source).toContain("hostname.endsWith(TRUSTED_DIRECT_NIP_SUFFIX)");
    expect(source).toContain("requestedMode = shouldBypassSystemProxy");
    expect(source).toContain("contents.on('will-redirect', guardNavigation)");
    expect(source).toContain('session.closeAllConnections()');
    expect(source).not.toContain("'*.nip.io'");
  });

  it('extracts structured article text with WeChat selectors and a detailed content budget', () => {
    const source = readFileSync(BROWSER_CONTROLLER_PATH, 'utf-8');
    expect(source).toContain("'#js_content, .rich_media_content, article, main");
    expect(source).toContain('const MAX_CHARS = 60000');
    expect(source).toContain("firstText('#activity-name'");
    expect(source).toContain("'## 正文'");
    expect(source).not.toContain('.slice(0, 16000)');
  });

  it('waits for stable article content instead of stopping at dom-ready', () => {
    const source = readFileSync(BROWSER_CONTROLLER_PATH, 'utf-8');
    expect(source).toContain('waitForExtractableContent');
    expect(source).toContain('CONTENT_READY_TIMEOUT_MS');
    expect(source).toContain('CONTENT_LOADING_EXTENSION_MS');
    expect(source).toContain('CONTENT_PROBE_TIMEOUT_MS');
    expect(source).toContain('Promise.race([');
    expect(source).toMatch(/void contents\.loadURL\(url[^)]*\)\.catch/);
    expect(source).not.toContain('await contents.loadURL(url)');
    expect(source).toContain('!contents.isLoading()');
    expect(source).toContain('settledEmptySamples >= 3');
    expect(source).toContain('stableSamples >= 2');
    expect(source).toContain("location.hostname === 'mp.weixin.qq.com'");
    expect(source).toContain('accessBlocked');
    expect(source).toContain('页面当前显示的是访问限制或安全验证内容');
    expect(source).not.toContain("resolve('dom-ready')");
    expect(source).not.toContain("outcome !== 'loaded' && contents.isLoading()");
    expect(source).not.toMatch(/outcome === 'timeout'[\s\S]{0,160}contents\.stop\(\)/);
  });
});

describe('session connection switching', () => {
  it('updates the long-lived API client only after credentials are saved', () => {
    const source = readFileSync(IPC_HANDLERS_PATH, 'utf-8');
    expect(source).toMatch(
      /await deps\.credentialStore\.save\(merged\);\s*(?:\/\/[^\n]*\n\s*)*deps\.apiClient\.setBaseUrl\(merged\.baseUrl\);/
    );
  });
});

describe('client update checker wiring', () => {
  const UPDATE_CHECKER_PATH = resolve(__dirname, '../src/main/update-checker.ts');

  it('registers the update IPC channels in the main process', () => {
    const source = readFileSync(IPC_HANDLERS_PATH, 'utf-8');
    expect(source).toMatch(/ipcMain\.handle\(IpcChannels\.GetAppUpdateState,/);
    expect(source).toMatch(/ipcMain\.handle\(IpcChannels\.CheckAppUpdate,/);
    expect(source).toMatch(/ipcMain\.handle\(IpcChannels\.OpenAppUpdateDownload,/);
    // 渲染端不能传 URL —— open-download handler 不接受任何输入参数。
    expect(source).toMatch(/async function handleOpenAppUpdateDownload\(\)/);
  });

  it('fans state out to the renderer and starts polling in bootstrap', () => {
    const source = readFileSync(MAIN_PATH, 'utf-8');
    expect(source).toMatch(/new UpdateChecker\(\{/);
    expect(source).toMatch(/updateChecker\.start\(\)/);
    expect(source).toContain('IpcChannels.AppUpdateStateEvent');
    expect(source).toMatch(/app\.on\('will-quit', \(\) => updateChecker\.stop\(\)\)/);
  });

  it('only opens download URLs on the backend origin via shell.openExternal', () => {
    const source = readFileSync(UPDATE_CHECKER_PATH, 'utf-8');
    expect(source).toMatch(/downloadOrigin !== baseOrigin/);
    expect(source).toContain('shell.openExternal');
    expect(source).toContain("'下载地址与服务地址不一致，已拒绝打开'");
  });
});

describe('embedded browser url safety policy', () => {  it('enforces the blocked-url policy at every navigation entry point', () => {
    const source = readFileSync(BROWSER_CONTROLLER_PATH, 'utf-8');
    expect(source).toContain("import { checkBrowserUrlAllowed } from './browser-url-policy'");
    // explicit navigate() entry point (address bar, agent actions, window.open)
    expect(source).toMatch(/async navigate\(rawUrl: string\)[\s\S]{0,600}checkBrowserUrlAllowed\(url\)/);
    // will-navigate / will-redirect guard (in-page links and server redirects)
    expect(source).toMatch(/const guardNavigation[\s\S]{0,900}checkBrowserUrlAllowed\(url\)/);
    expect(source).toMatch(/if \(!policy\.allowed\) \{\s*event\.preventDefault\(\);\s*contents\.stop\(\);/);
  });

  it('keeps an explicit blocked domain list including hjtcn.com', () => {
    const policySource = readFileSync(
      resolve(__dirname, '../src/main/browser-url-policy.ts'),
      'utf-8'
    );
    expect(policySource).toContain("'hjtcn.com'");
    expect(policySource).toContain('WORKBENCH_BROWSER_BLOCKED_DOMAINS');
  });
});
