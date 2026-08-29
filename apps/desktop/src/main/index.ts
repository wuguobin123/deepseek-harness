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
import { createRequire } from 'node:module'
import { ApiClient } from './api-client'
import { CredentialStore } from './credential-store'
import { UpdateChecker } from './update-checker'
import { ArtifactFileActions } from './artifact-files'
import { createIpcHandlers, installSecurityGuards } from './ipc-handlers'
import { AuthStateSchema, IpcChannels, type AuthState } from '../shared/contracts'
import { registerArtifactPreviewProtocol, registerArtifactPreviewScheme } from './artifact-preview-protocol'
import { LocalRuntimeSupervisor } from './local-runtime-supervisor'
import { LocalSkillDirectoryManager } from './local-skill-directory'
import { DualHostRouter } from './dual-host-router'
import { parseAccountInferenceRequest } from '@deepseek-ai/dsh-llm-account-inference'

registerArtifactPreviewScheme()

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

  const credentialStore = new CredentialStore(DEFAULT_BASE_URL)
  await credentialStore.load()

  const apiClient = new ApiClient({
    baseUrl: credentialStore.snapshot().baseUrl || DEFAULT_BASE_URL,
  })
  const localBin = app.isPackaged
    ? path.join(process.resourcesPath, 'local-runtime', 'bin', 'xiaowei-device-runtime.mjs')
    : path.join(path.dirname(createRequire(__filename).resolve('@deepseek-ai/dsh-xiaowei-device-runtime/package.json')), 'bin', 'xiaowei-device-runtime.mjs')
  const localSupervisor = new LocalRuntimeSupervisor({
    userDataPath: app.getPath('userData'),
    runtimeBin: localBin,
    inferenceBridge: {
      stream(request, signal) {
        return apiClient.streamAccountInference(parseAccountInferenceRequest(request), signal)
      },
    },
    searchBridge: {
      search(request, signal) {
        return apiClient.searchAccountWeb(request, signal)
      },
    },
  })
  const localSkillDirectory = new LocalSkillDirectoryManager({
    dshHome: path.join(app.getPath('userData'), 'local-runtime'),
  })
  let localClient: ApiClient | null = null
  const ensureLocal = async (): Promise<ApiClient> => {
    if (localClient) return localClient
    localClient = new ApiClient({ baseUrl: await localSupervisor.start() })
    return localClient
  }
  // The cloud Host is the default product view. The loopback Host is started
  // only when a local resource is selected or a local RPC is first addressed.
  const router = new DualHostRouter(apiClient, () => localClient, ensureLocal)
  // Bootstrap the bearer token from the persisted v3 blob (xiaowei
  // multi-user backend). When the user signs in via SignInCard, the IPC
  // handlers update this same token and broadcast a fresh AuthState.
  const persistedToken = credentialStore.snapshot().sessionToken
  if (persistedToken !== undefined && persistedToken.length > 0) {
    apiClient.setToken(persistedToken)
  }
  registerArtifactPreviewProtocol(artifactId => router.call('artifact.read', { artifactId }))

  const updateChecker = new UpdateChecker({
    baseUrl: () => credentialStore.snapshot().baseUrl || DEFAULT_BASE_URL,
    currentVersion: app.getVersion(),
    onStateChange: (state) => {
      mainWindow?.webContents.send(IpcChannels.AppUpdateStateEvent, state)
    },
  })
  updateChecker.start()
  app.on('will-quit', () => { updateChecker.stop() })

  const artifactFiles = new ArtifactFileActions({
    readArtifact: artifactId => router.call('artifact.read', { artifactId }),
    downloadsDirectory: app.getPath('downloads'),
    temporaryDirectory: app.getPath('temp'),
  })
  let artifactCleanupComplete = false
  app.on('will-quit', (event) => {
    if (artifactCleanupComplete) return
    event.preventDefault()
    void Promise.all([artifactFiles.dispose(), localSupervisor.stop()]).finally(() => {
      artifactCleanupComplete = true
      app.quit()
    })
  })

  /** Validate and forward AuthState changes to every renderer window. */
  function broadcastAuthState(state: AuthState): void {
    const parsed = AuthStateSchema.parse(state)
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IpcChannels.AuthStateEvent, parsed)
    }
  }

  mainWindow = createMainWindow()
  const ipc = createIpcHandlers({
    apiClient,
    router,
    credentialStore,
    baseUrl: () => credentialStore.snapshot().baseUrl || DEFAULT_BASE_URL,
    updateChecker: () => updateChecker,
    artifactFiles,
    localSkillDirectory,
    mainWindow: () => mainWindow,
    broadcastAuthState,
    cancelLocalInferenceStreams: (code, message) => localSupervisor.cancelAccountRequests(code, message),
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
        router,
        credentialStore,
        baseUrl: () => credentialStore.snapshot().baseUrl || DEFAULT_BASE_URL,
        updateChecker: () => updateChecker,
        artifactFiles,
        localSkillDirectory,
        mainWindow: () => mainWindow,
        broadcastAuthState,
        cancelLocalInferenceStreams: (code, message) => localSupervisor.cancelAccountRequests(code, message),
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
    title: '小薇',
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

  win.once('ready-to-show', () =>{  win.show() })

  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault()
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  return win
}

function registerSecurityHeaders(): void {
  session.defaultSession.webRequest.onHeadersReceived({ urls: ['file://*/*'] }, (details, callback) => {
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
            "frame-src 'self' blob: xiaowei-artifact:; " +
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

void app.whenReady().then(() => {
  bootstrap().catch((err: unknown) => {
    console.error('failed to bootstrap workbench desktop:', err)
    app.exit(1)
  })
})

export const __testing__ = { createMainWindow, pathToFileURL }
