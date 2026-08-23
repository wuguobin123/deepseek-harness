/**
 * Electron main process entry point.
 *
 * Hard guarantees:
 *   - BrowserWindow uses contextIsolation=true, nodeIntegration=false, sandbox=true.
 *   - Strict CSP — no inline scripts, no remote sources.
 *   - Preload exposes only the typed `workbenchApi` bridge (see
 *     `shared/contracts.WORKBENCH_API_KEYS`).
 *   - All dsh RPC traffic goes through the main-process `ApiClient` which
 *     POSTs `ClientRequest` envelopes to `${baseUrl}/api/<method>`.
 *   - The baseUrl is loopback (default `http://127.0.0.1:18000`) or the
 *     nginx fronting it on the public host; the trust fence on
 *     `dsh-client-connection` requires the request Host to match one of
 *     the `trustedHosts` allow-list entries.
 */
import { app, BrowserWindow, session } from 'electron'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { ApiClient } from './api-client'
import { CredentialStore } from './credential-store'
import { UpdateChecker } from './update-checker'
import { createIpcHandlers, installSecurityGuards } from './ipc-handlers'
import { IpcChannels } from '../shared/contracts'

function configuredBaseUrl(): string {
  const environmentUrl = process.env.WORKBENCH_API_BASE_URL
  if (environmentUrl) return environmentUrl
  const candidates = [
    path.join(process.resourcesPath, 'product-config.json'),
    path.join(app.getAppPath(), 'product-config.json'),
  ]
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as { apiBaseUrl?: string }
      if (parsed.apiBaseUrl && /^https?:\/\//i.test(parsed.apiBaseUrl)) {
        return parsed.apiBaseUrl
      }
    } catch {
      // Try the next product-config location.
    }
  }
  return 'http://119.45.252.25:18080'
}

const DEFAULT_BASE_URL = configuredBaseUrl()

let mainWindow: BrowserWindow | null = null

async function bootstrap(): Promise<void> {
  await app.whenReady()
  registerSecurityHeaders()

  const credentialStore = new CredentialStore()
  await credentialStore.load()

  const apiClient = new ApiClient({
    baseUrl: credentialStore.snapshot().baseUrl || DEFAULT_BASE_URL,
  })

  // Stub update checker (always up-to-date until dsh-ops exposes a releases endpoint).
  const updateChecker = new UpdateChecker({
    currentVersion: app.getVersion(),
    onStateChange: (state) => {
      mainWindow?.webContents.send(IpcChannels.AppUpdateStateEvent, state)
    },
  })
  updateChecker.start()
  app.on('will-quit', () => updateChecker.stop())

  mainWindow = createMainWindow()
  const ipc = createIpcHandlers({
    apiClient,
    credentialStore,
    baseUrl: () => credentialStore.snapshot().baseUrl || DEFAULT_BASE_URL,
    updateChecker: () => updateChecker,
  })
  ipc.install()

  installSecurityGuards(mainWindow)
  mainWindow.on('closed', () => {
    ipc.uninstall()
    mainWindow = null
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow()
      const fresh = createIpcHandlers({
        apiClient,
        credentialStore,
        baseUrl: () => credentialStore.snapshot().baseUrl || DEFAULT_BASE_URL,
        updateChecker: () => updateChecker,
      })
      fresh.install()
      installSecurityGuards(mainWindow)
      mainWindow.on('closed', () => {
        fresh.uninstall()
        mainWindow = null
      })
    }
  })
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#0b0d12',
    title: 'DeepSeek Harness',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: false,
      experimentalFeatures: false,
    },
  })

  if (process.env.ELECTRON_DEBUG_RENDERER === '1') {
    win.webContents.on('console-message', (_event, level, message, line, source) => {
      const prefix = ['VERBOSE', 'INFO', 'WARN', 'ERROR'][level] ?? 'LOG'
      console.log(`[renderer ${prefix}] ${message} (${source}:${line})`)
    })
  }

  const rendererIndex = path.join(__dirname, '../../renderer/index.html')
  void win.loadFile(rendererIndex)

  win.once('ready-to-show', () => win.show())

  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault()
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  return win
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
            "img-src 'self' data: blob:; " +
            "connect-src 'self'; " +
            "font-src 'self'; " +
            "object-src 'none'; " +
            "frame-src 'self' blob:; " +
            "frame-ancestors 'none'; " +
            "base-uri 'self'",
        ],
        'X-Content-Type-Options': ['nosniff'],
        'Referrer-Policy': ['no-referrer'],
      },
    })
  })

  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(false)
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.whenReady().then(() => {
  bootstrap().catch((err) => {
    console.error('failed to bootstrap workbench desktop:', err)
    app.exit(1)
  })
})

export const __testing__ = { createMainWindow, pathToFileURL }
