import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

const { handlers, showOpenDialog } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  showOpenDialog: vi.fn(),
}))
vi.mock('electron', () => ({
  BrowserWindow: function BrowserWindow() {},
  dialog: { showOpenDialog },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) => { handlers.set(channel, handler) },
    removeHandler: (channel: string) => { handlers.delete(channel) },
  },
}))

import { createIpcHandlers } from '../src/main/ipc-handlers'
import type { Credentials } from '../src/main/credential-store'
import { IpcChannels, type AuthState } from '../src/shared/contracts'

const ARTIFACT_ID = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

function deferredStream(events: string[], name: string): (signal: AbortSignal) => AsyncIterable<unknown> {
  return async function* (signal: AbortSignal): AsyncGenerator {
    events.push(`${name}:started`)
    await new Promise<void>((resolve) =>{  signal.addEventListener('abort', () => {
      events.push(`${name}:aborted`)
      resolve()
    }, { once: true }) })
    events.push(`${name}:finished`)
    yield* []
  }
}

function setup(
  events: string[],
  router?: { call: (method: string, payload: unknown) => Promise<unknown> },
  localSkillDirectory?: {
    list(): Promise<readonly unknown[]>
    install(sourceDirectory: string): Promise<unknown>
  },
) {
  const apiClient = {
    call: vi.fn(async (method: string): Promise<unknown> => {
      if (method === 'account.signin') {
        return { userId: 'user-b', displayName: null, sessionToken: 'token-b', expiresAt: Date.now() + 60_000 }
      }
      return { revoked: true }
    }),
    respond: vi.fn(async () => undefined),
    setBaseUrl: vi.fn((baseUrl: string) => { events.push(`base-url:${baseUrl}`) }),
    setToken: vi.fn((token: string | null) => { events.push(`token:${token ?? 'null'}`) }),
    getToken: vi.fn(() => null),
    streamMux: vi.fn(deferredStream(events, 'mux')),
    streamHost: vi.fn(deferredStream(events, 'host')),
  }
  const credentialStore = {
    snapshot: vi.fn<() => Credentials>(() => ({ baseUrl: 'http://harness.test' })),
    save: vi.fn(async (input: Record<string, unknown>) => {
      const token = typeof input.sessionToken === 'string' ? input.sessionToken : 'none'
      events.push(`saved:${token}`)
    }),
    saveConnection: vi.fn(async () => undefined),
    authState: vi.fn(() => ({ signedIn: false as const })),
  }
  const ipc = createIpcHandlers({
    apiClient,
    router,
    credentialStore,
    baseUrl: () => 'http://harness.test',
    updateChecker: () => ({ getState: () => ({ status: 'idle' }), check: async () => ({ status: 'idle' }), openDownload: async () => undefined }),
    artifactFiles: {
      save: vi.fn(async () => ({ status: 'saved' as const })),
      openHtmlInBrowser: vi.fn(async () => ({ opened: true as const })),
    },
    localSkillDirectory,
    mainWindow: () => null,
    broadcastAuthState: (state: AuthState) => { events.push(`broadcast:${String(state.signedIn)}`) },
    cancelLocalInferenceStreams: vi.fn(async (code?: string) => { events.push(`inference:${code ?? 'cancelled'}`) }),
  } as never)
  ipc.install()
  return { apiClient, credentialStore, ipc }
}

describe('desktop IPC account stream teardown', () => {
  it('registers a live local directory without reading or uploading its files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-ipc-local-workspace-'))
    try {
      await writeFile(join(root, 'over-cloud-limit.bin'), Buffer.alloc(6 * 1024 * 1024))
      showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [root] })
      const events: string[] = []
      const { apiClient, credentialStore, ipc } = setup(events)
      credentialStore.snapshot.mockReturnValue({ baseUrl: 'http://harness.test', lastLocation: 'local' })
      apiClient.call.mockResolvedValueOnce({ workspace: { path: await realpath(root) }, created: true })

      await expect(handlers.get(IpcChannels.ImportDirectory)?.({}, { location: 'local' })).resolves.toMatchObject({
        ok: true,
        value: { workspace: { path: await realpath(root) }, created: true },
      })
      const dialogOptions = showOpenDialog.mock.lastCall?.at(-1) as {
        title?: unknown
        buttonLabel?: unknown
        message?: unknown
      } | undefined
      expect(dialogOptions).toMatchObject({
        title: '选择本机工作区',
        buttonLabel: '使用此目录',
      })
      expect(dialogOptions?.message).toContain('本机目录不会整体复制到云端')
      expect(dialogOptions?.message).toContain('任务所需内容可能发送给模型服务')
      expect(apiClient.call).toHaveBeenCalledWith('workspace.create', { path: await realpath(root), location: 'local' })
      expect(apiClient.call.mock.calls.map(call => call[0])).not.toContain('workspace.importDirectory')
      ipc.uninstall()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('opens the local-copy picker and forwards bounded file entries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-ipc-import-'))
    try {
      await writeFile(join(root, 'hello.txt'), 'hello')
      showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [root] })
      const events: string[] = []
      const router = {
        call: vi.fn(async (_method: string, _payload: unknown) => (
          { workspace: { workspaceId: 'dsh:cloud:copy' }, created: true }
        )),
      }
      const { ipc } = setup(events, router)

      await expect(handlers.get(IpcChannels.ImportDirectory)?.({}, { location: 'cloud' })).resolves.toMatchObject({
        ok: true,
        value: { workspace: { workspaceId: 'dsh:cloud:copy' }, created: true },
      })
      const dialogOptions = showOpenDialog.mock.lastCall?.at(-1) as {
        title?: unknown
        buttonLabel?: unknown
        message?: unknown
      } | undefined
      expect(dialogOptions).toMatchObject({
        title: '导入本机目录副本',
        buttonLabel: '导入副本',
      })
      expect(dialogOptions?.message).toContain('云端副本独立保存且不自动同步')
      expect(dialogOptions?.message).toContain('任务所需内容可能发送给模型服务')
      const importCall = router.call.mock.calls.find(call => call[0] === 'workspace.importDirectory') as
        unknown as [string, { importId: string; title: string; files: { path: string; content: string }[] }]
      expect(importCall[1]).toMatchObject({
        title: basename(root),
        files: [{ path: 'hello.txt', content: 'aGVsbG8=' }],
      })
      expect(importCall[1].importId).toMatch(/^[0-9a-f-]{36}$/)
      ipc.uninstall()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps local Skill paths inside the native main-process install flow', async () => {
    const selectedDirectory = '/private/selected/frontend-slides'
    const skill = {
      directoryName: 'frontend-slides',
      name: 'frontend-slides',
      description: 'Presentation Skill',
      fileCount: 163,
      totalBytes: 3_532_176,
      valid: true,
    }
    const localSkillDirectory = {
      list: vi.fn(async () => [skill]),
      install: vi.fn(async () => ({ status: 'installed', skill })),
    }
    const { ipc } = setup([], undefined, localSkillDirectory)

    await expect(handlers.get(IpcChannels.ListSkills)?.({}, { path: '/renderer-supplied' })).resolves.toEqual({
      ok: true,
      value: [skill],
    })
    showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [selectedDirectory] })
    const result = await handlers.get(IpcChannels.InstallSkill)?.({}, { path: '/renderer-supplied' })
    expect(localSkillDirectory.install).toHaveBeenCalledWith(selectedDirectory)
    expect(JSON.stringify(result)).not.toContain(selectedDirectory)
    expect(JSON.stringify(result)).not.toContain('renderer-supplied')
    expect(showOpenDialog.mock.lastCall?.at(-1)).toMatchObject({ properties: ['openDirectory'] })

    showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    await expect(handlers.get(IpcChannels.InstallSkill)?.({}, { path: '/renderer-supplied' })).resolves.toEqual({
      ok: true,
      value: { status: 'cancelled' },
    })
    expect(localSkillDirectory.install).toHaveBeenCalledOnce()
    ipc.uninstall()
  })

  it('sends a valid terminal frame when a downlink fails', async () => {
    const events: string[] = []
    const { apiClient, ipc } = setup(events)
    apiClient.streamMux.mockImplementation(async function* (): AsyncGenerator {
      yield await Promise.reject(Object.assign(new Error('event stream stopped'), { code: 'STREAM_IDLE' }))
    })
    const sender = { isDestroyed: () => false, send: vi.fn() }

    await handlers.get(IpcChannels.SubscribeMux)?.({ sender })

    await vi.waitFor(() =>{  expect(sender.send).toHaveBeenCalledWith(
      IpcChannels.MuxEvent,
      {
        rpcId: 'desktop-stream-error',
        method: 'stream/error',
        payload: {
          type: 'stream/error',
          error: { code: 'internal', message: 'event stream stopped', details: {} },
        },
      },
    ) })
    ipc.uninstall()
  })

  it('awaits both old streams before installing a sign-in token', async () => {
    const events: string[] = []
    const { apiClient, ipc } = setup(events)
    const sender = { isDestroyed: () => false, send: vi.fn() }
    await handlers.get(IpcChannels.SubscribeMux)?.({ sender })
    await handlers.get(IpcChannels.SubscribeHost)?.({ sender })
    await vi.waitFor(() =>{  expect(events).toEqual(expect.arrayContaining(['mux:started', 'host:started'])) })

    const result = await handlers.get(IpcChannels.SignIn)?.({}, { email: 'b@example.com', password: 'secret' })
    expect(result).toMatchObject({ ok: true })
    expect(apiClient.setToken).toHaveBeenCalledWith('token-b')
    const tokenIndex = events.indexOf('token:token-b')
    expect(tokenIndex).toBeGreaterThan(events.indexOf('mux:finished'))
    expect(tokenIndex).toBeGreaterThan(events.indexOf('host:finished'))
    expect(tokenIndex).toBeGreaterThan(events.indexOf('inference:ACCOUNT_SESSION_CHANGED'))
    expect(events).toEqual(expect.arrayContaining(['mux:aborted', 'host:aborted']))
    ipc.uninstall()
  })

  it('reports a successful update-download launch to the renderer', async () => {
    const events: string[] = []
    const { ipc } = setup(events)
    await expect(handlers.get(IpcChannels.OpenAppUpdateDownload)?.({})).resolves.toEqual({ ok: true })
    ipc.uninstall()
  })

  it('validates and forwards native artifact actions by id only', async () => {
    const events: string[] = []
    const { ipc } = setup(events)
    const input = { artifactId: ARTIFACT_ID }

    await expect(handlers.get(IpcChannels.SaveArtifact)?.({}, input)).resolves.toEqual({
      ok: true,
      value: { status: 'saved' },
    })
    await expect(handlers.get(IpcChannels.OpenArtifactInBrowser)?.({}, input)).resolves.toEqual({
      ok: true,
      value: { opened: true },
    })
    await expect(handlers.get(IpcChannels.SaveArtifact)?.({}, { artifactId: '../../secret' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' },
    })
    ipc.uninstall()
  })

  it('preserves the persisted account when updating the backend address', async () => {
    const events: string[] = []
    const { apiClient, credentialStore, ipc } = setup(events)
    credentialStore.snapshot.mockReturnValue({
      baseUrl: 'http://127.0.0.1:18000',
      sessionToken: 'token-a',
      userId: 'user-a',
      displayName: 'Alice',
      expiresAt: 1_800_000_000_000,
    })

    await expect(handlers.get(IpcChannels.UpdateSession)?.({}, {
      baseUrl: 'http://119.45.252.25:18080',
    })).resolves.toEqual({
      ok: true,
      value: { baseUrl: 'http://119.45.252.25:18080' },
    })
    expect(credentialStore.saveConnection).toHaveBeenCalledWith({
      baseUrl: 'http://119.45.252.25:18080',
      lastLocation: 'cloud',
    })
    expect(credentialStore.save).not.toHaveBeenCalled()
    expect(apiClient.setBaseUrl).toHaveBeenCalledWith('http://119.45.252.25:18080')
    ipc.uninstall()
  })
})
