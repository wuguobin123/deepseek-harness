/**
 * Electron main process entry point.
 *
 * Hard guarantees:
 *   - BrowserWindow uses contextIsolation=true, nodeIntegration=false, sandbox=true.
 *   - Strict CSP — no inline scripts, no remote sources.
 *   - Preload exposes only the typed `workbenchApi` bridge.
 *   - All API requests go through the main-process `ApiClient` which injects
 *     X-API-Key, X-Tenant-ID, X-Actor-ID.
 *   - `shell.openExternal` is reached only via `VerifiedLinkOpener` after a
 *     fresh authorize-open round-trip with the backend.
 */
import { app, BrowserWindow, session, shell } from 'electron';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ApiClient } from './api-client';
import {
  EMBEDDED_BROWSER_PARTITION,
  EmbeddedBrowserController
} from './browser-controller';
import { CredentialStore } from './credential-store';
import { VerifiedLinkOpener } from './verified-links';
import { UpdateChecker } from './update-checker';
import { createIpcHandlers, installSecurityGuards } from './ipc-handlers';
import { IpcChannels } from '../shared/contracts';

function configuredBaseUrl(): string {
  const environmentUrl = process.env.WORKBENCH_API_BASE_URL;
  if (environmentUrl) return environmentUrl;
  const candidates = [
    path.join(process.resourcesPath, 'product-config.json'),
    path.join(app.getAppPath(), 'product-config.json')
  ];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as { apiBaseUrl?: string };
      if (parsed.apiBaseUrl && /^https?:\/\//i.test(parsed.apiBaseUrl)) {
        return parsed.apiBaseUrl;
      }
    } catch {
      // Try the next product-config location.
    }
  }
  return 'http://119.45.252.25:18080';
}

const DEFAULT_BASE_URL = configuredBaseUrl();

let mainWindow: BrowserWindow | null = null;

async function bootstrap(): Promise<void> {
  await app.whenReady();
  registerSecurityHeaders();

  const credentialStore = new CredentialStore();
  await credentialStore.load();

  const apiClient = new ApiClient({
    baseUrl: credentialStore.snapshot().baseUrl || DEFAULT_BASE_URL,
    credentials: () => credentialStore.snapshot()
  });

  const verifiedLinks = new VerifiedLinkOpener(apiClient);

  // 客户端更新检查：与 apiClient 共用同一 baseUrl 来源，状态变化推送给当前窗口。
  // checker 整个进程只建一次，窗口重建（closed/activate）不影响轮询。
  const updateChecker = new UpdateChecker({
    baseUrl: () => credentialStore.snapshot().baseUrl || DEFAULT_BASE_URL,
    currentVersion: app.getVersion(),
    onStateChange: (state) => {
      mainWindow?.webContents.send(IpcChannels.AppUpdateStateEvent, state);
    }
  });
  updateChecker.start();
  app.on('will-quit', () => updateChecker.stop());

  mainWindow = createMainWindow();
  const browserRef: { current: EmbeddedBrowserController | null } = {
    current: new EmbeddedBrowserController(
      mainWindow,
      () => credentialStore.snapshot(),
      () => credentialStore.snapshot().baseUrl || DEFAULT_BASE_URL
    )
  };
  const ipc = createIpcHandlers({
    apiClient,
    credentialStore,
    verifiedLinks,
    baseUrl: () => credentialStore.snapshot().baseUrl || DEFAULT_BASE_URL,
    updateChecker: () => updateChecker,
    browser: () => {
      if (!browserRef.current) throw new Error('embedded browser is not available');
      return browserRef.current;
    }
  });
  ipc.install();

  installSecurityGuards(mainWindow);
  mainWindow.on('closed', () => {
    browserRef.current?.dispose();
    browserRef.current = null;
    mainWindow = null;
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
      browserRef.current = new EmbeddedBrowserController(
        mainWindow,
        () => credentialStore.snapshot(),
        () => credentialStore.snapshot().baseUrl || DEFAULT_BASE_URL
      );
      installSecurityGuards(mainWindow);
      mainWindow.on('closed', () => {
        browserRef.current?.dispose();
        browserRef.current = null;
        mainWindow = null;
      });
    }
  });
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#0b0d12',
    title: '企业 AI 工作台',
    // Frameless-with-inset titlebar on macOS gives the packaged app a native
    // feel; the renderer sidebar reserves space for the traffic lights.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: false,
      // Block remote module just in case.
      experimentalFeatures: false
    }
  });

  // 调试期（E2E 排错用）：把渲染进程 console 镜像到主进程 stdout，便于
  // 通过 `tee /tmp/desktop.log` 观察。生产部署需要按 env 关闭。
  if (process.env.ELECTRON_DEBUG_RENDERER === '1') {
    win.webContents.on('console-message', (_event, level, message, line, source) => {
      const prefix = ['VERBOSE', 'INFO', 'WARN', 'ERROR'][level] ?? 'LOG';
      console.log(`[renderer ${prefix}] ${message} (${source}:${line})`);
    });
  }

  const rendererIndex = path.join(__dirname, '../../renderer/index.html');
  void win.loadFile(rendererIndex);

  win.once('ready-to-show', () => win.show());

  // Disable opening arbitrary URLs from the renderer.
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  return win;
}

function registerSecurityHeaders(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; " +
            "script-src 'self'; " +
            "style-src 'self' 'unsafe-inline'; " +
            // 图片 artifact 通过受控 IPC 读取后转换为 blob: URL，避免向 DOM 暴露认证信息。
            "img-src 'self' data: blob:; " +
            "connect-src 'self'; " +
            "font-src 'self'; " +
            "object-src 'none'; " +
            // 文档预览用 blob: URL 喂给内嵌 iframe（HTML 文本预览 / 转换后的 PDF），
            // 必须显式放行 blob:，否则 default-src 'self' 会把 iframe 挡成空白。
            "frame-src 'self' blob:; " +
            "frame-ancestors 'none'; " +
            "base-uri 'self'"
        ],
        'X-Content-Type-Options': ['nosniff'],
        'Referrer-Policy': ['no-referrer']
      }
    });
  });

  // Permission requests are denied by default; nothing needs camera/mic/etc.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => {
    void _wc;
    void _permission;
    callback(false);
  });
}

app.on('web-contents-created', (_event, contents) => {
  // WebContentsView reports the same `window` type as BrowserWindow. Do not
  // install the shell renderer's file-only navigation guard on the isolated
  // embedded-browser partition: its own controller permits HTTP(S) main-frame
  // navigation while independently denying popups, downloads and permissions.
  const isEmbeddedBrowser =
    contents.session === session.fromPartition(EMBEDDED_BROWSER_PARTITION);
  if (contents.getType() === 'window' && !isEmbeddedBrowser) {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-attach-webview', (event) => event.preventDefault());
    contents.on('will-navigate', (event, url) => {
      if (!url.startsWith('file://')) event.preventDefault();
    });
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Block external link protocol from renderer-side code.
void shell;

app.whenReady().then(() => {
  bootstrap().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('failed to bootstrap workbench desktop:', err);
    app.exit(1);
  });
});

// Allow tests to import without launching Electron.
export const __testing__ = { createMainWindow, pathToFileURL };
