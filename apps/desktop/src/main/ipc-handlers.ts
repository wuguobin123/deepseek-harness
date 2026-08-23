/**
 * Typed ipcMain handlers.
 *
 * Every handler validates its input against a Zod schema from
 * `../shared/contracts` before doing anything. This is the choke point — the
 * renderer never has raw `ipcRenderer` access, and the preload script cannot
 * reach anything that hasn't been registered here.
 */
import {
  BrowserWindow,
  dialog,
  ipcMain,
  type OpenDialogOptions,
  shell,
  WebContents
} from 'electron';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import {
  IpcChannels,
  AssistantStreamEventSchema,
  AssistantStreamInputSchema,
  ArtifactPickerInputSchema,
  ClipboardImageInputSchema,
  KnowledgeDocumentPickerInputSchema,
  KnowledgeDocumentPickerResultSchema,
  BrowserArtifactInputSchema,
  RequestInputSchema,
  SessionUpdateSchema,
  AccountAuthenticationSchema,
  EmailCodeRequestSchema,
  EmailCodeResponseSchema,
  AnomalyStreamEventSchema,
  BrowserActionSchema,
  BrowserBoundsSchema,
  BrowserNavigateInputSchema
} from '../shared/contracts';
import { ApiClient } from './api-client';
import { EmbeddedBrowserController } from './browser-controller';
import { CredentialStore } from './credential-store';
import { VerifiedLinkOpener } from './verified-links';
import { AnomalyEventStream } from './event-stream';
import { convertToPdf, hasAvailableTool, isConversionSupported } from './pdf-converter';
import { withArtifactPreviewToken } from './artifact-preview-link';
import type { UpdateChecker } from './update-checker';

interface HandlersDeps {
  apiClient: ApiClient;
  credentialStore: CredentialStore;
  verifiedLinks: VerifiedLinkOpener;
  baseUrl: () => string;
  browser: () => EmbeddedBrowserController;
  updateChecker: () => UpdateChecker;
}

export interface IpcHandlers {
  install(): void;
  uninstall(): void;
}

class ActiveSubscriptions {
  private readonly map = new Map<number, AbortController>();

  add(webContentsId: number, controller: AbortController): void {
    this.map.set(webContentsId, controller);
  }

  cancel(webContentsId: number): void {
    const existing = this.map.get(webContentsId);
    if (existing) {
      existing.abort();
      this.map.delete(webContentsId);
    }
  }

  cancelAll(): void {
    for (const controller of this.map.values()) controller.abort();
    this.map.clear();
  }
}

class ActiveAssistantStreams {
  private readonly map = new Map<
    string,
    {
      controller: AbortController;
      conversationId: string;
      clientMessageId: string;
      runId?: string;
    }
  >();

  private key(webContentsId: number, requestId: string): string {
    return `${webContentsId}:${requestId}`;
  }

  add(
    webContentsId: number,
    requestId: string,
    controller: AbortController,
    conversationId: string,
    clientMessageId: string
  ): void {
    this.cancel(webContentsId, requestId);
    this.map.set(this.key(webContentsId, requestId), {
      controller,
      conversationId,
      clientMessageId
    });
  }

  setRunId(webContentsId: number, requestId: string, runId: string): void {
    const active = this.map.get(this.key(webContentsId, requestId));
    if (active) active.runId = runId;
  }

  get(webContentsId: number, requestId: string) {
    return this.map.get(this.key(webContentsId, requestId));
  }

  cancel(webContentsId: number, requestId: string): void {
    const key = this.key(webContentsId, requestId);
    const existing = this.map.get(key);
    if (existing) existing.controller.abort();
    this.map.delete(key);
  }

  cancelAll(): void {
    for (const active of this.map.values()) active.controller.abort();
    this.map.clear();
  }
}

export function createIpcHandlers(deps: HandlersDeps): IpcHandlers {
  const subscriptions = new ActiveSubscriptions();
  const assistantStreams = new ActiveAssistantStreams();

  async function handleRequest(event: Electron.IpcMainInvokeEvent, raw: unknown) {
    const parsed = RequestInputSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        status: 400,
        body: { error: { code: 'INVALID_INPUT', message: parsed.error.message } }
      };
    }
    const input = parsed.data;
    if (input.stream) {
      return { status: 400, body: { error: { code: 'STREAM_NOT_SUPPORTED', message: 'use subscribeAnomalies for streams' } } };
    }
    try {
      return await deps.apiClient.request({
        method: input.method,
        path: input.path,
        body: input.body,
        idempotencyKey: input.idempotencyKey,
        expectedVersion: input.expectedVersion,
        timeoutMs: input.timeoutMs
      });
    } catch (err) {
      const status = (err as { status?: number }).status ?? 0;
      const code = (err as { code?: string }).code ?? 'NETWORK_ERROR';
      const message = err instanceof Error ? err.message : String(err);
      return { status: status || 500, body: { error: { code, message, status: status || 500 } } };
    }
  }

  async function handleOpenArtifact(event: Electron.IpcMainInvokeEvent, raw: unknown) {
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > 256) {
      return { ok: false, error: { code: 'INVALID_ARTIFACT_ID', message: 'artifact id is required' } };
    }
    try {
      const result = await deps.verifiedLinks.openArtifact(raw);
      return { ok: true, url: result.url, expiresAt: result.expiresAt };
    } catch (err) {
      const code = (err as { code?: string }).code ?? 'OPEN_FAILED';
      const status = (err as { status?: number }).status ?? 500;
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: { code, message, status } };
    }
  }

  function handleStartAssistantStream(
    event: Electron.IpcMainInvokeEvent,
    raw: unknown
  ) {
    const parsed = AssistantStreamInputSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false,
        error: { code: 'INVALID_INPUT', message: parsed.error.message }
      };
    }
    const input = parsed.data;
    const wc = event.sender;
    const controller = new AbortController();
    assistantStreams.add(
      wc.id,
      input.requestId,
      controller,
      input.conversationId,
      input.clientMessageId
    );

    void (async () => {
      let reconnectAttempt = 0;
      let terminal = false;
      while (!controller.signal.aborted && !terminal) {
        try {
          await deps.apiClient.streamSse(
        {
          method: 'POST',
          path: `/api/conversations/${encodeURIComponent(
            input.conversationId
          )}/assistant/stream`,
          body: {
            message: input.message,
            client_message_id: input.clientMessageId,
            attachment_ids: input.attachmentIds,
            ...(input.knowledgeBaseIds !== undefined
              ? { knowledge_base_ids: input.knowledgeBaseIds }
              : {}),
            deep_mode: input.deepMode
          },
          idempotencyKey: input.clientMessageId,
          signal: controller.signal
        },
        ({ data }) => {
          const streamEvent = AssistantStreamEventSchema.safeParse(data);
          if (!streamEvent.success || wc.isDestroyed()) return;
          if (streamEvent.data.type === 'accepted') {
            assistantStreams.setRunId(
              wc.id,
              input.requestId,
              streamEvent.data.runId
            );
          }
          terminal =
            streamEvent.data.type === 'completed' || streamEvent.data.type === 'error';
          wc.send(IpcChannels.AssistantStreamEvent, {
            requestId: input.requestId,
            event: streamEvent.data
          });
        }
          );
          reconnectAttempt = 0;
        } catch (error: unknown) {
          if (controller.signal.aborted || wc.isDestroyed()) return;
          reconnectAttempt += 1;
          wc.send(IpcChannels.AssistantStreamEvent, {
            requestId: input.requestId,
            event: {
              type: 'status',
              phase: 'reconnecting',
              message: `连接中断，正在恢复生成进度（第 ${reconnectAttempt} 次）…`
            }
          });
          await new Promise((resolve) =>
            setTimeout(resolve, Math.min(500 * 2 ** reconnectAttempt, 5_000))
          );
        }
      }
      assistantStreams.cancel(wc.id, input.requestId);
    })();
    return { ok: true };
  }

  async function handleCancelAssistantStream(
    event: Electron.IpcMainInvokeEvent,
    requestId: unknown
  ) {
    if (typeof requestId !== 'string' || !requestId || requestId.length > 160) {
      return { ok: false };
    }
    const active = assistantStreams.get(event.sender.id, requestId);
    assistantStreams.cancel(event.sender.id, requestId);
    if (active?.runId) {
      await deps.apiClient.request({
        method: 'POST',
        path: `/api/conversations/${encodeURIComponent(
          active.conversationId
        )}/assistant/runs/${encodeURIComponent(active.runId)}/cancel`
      });
    } else if (active) {
      await deps.apiClient.request({
        method: 'POST',
        path: `/api/conversations/${encodeURIComponent(
          active.conversationId
        )}/assistant/cancel`,
        body: { client_message_id: active.clientMessageId }
      });
    }
    return { ok: true };
  }

  async function handleSelectAndUploadArtifact(
    event: Electron.IpcMainInvokeEvent,
    raw: unknown
  ) {
    const parsed = ArtifactPickerInputSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false as const, error: '会话参数无效' };
    }
    const owner = BrowserWindow.fromWebContents(event.sender);
    const dialogOptions: OpenDialogOptions = {
      title: '选择要分析的文件',
      properties: ['openFile'],
      filters: [
        {
          name: '工作文件 / Skill 包',
          extensions: ['xlsx', 'csv', 'docx', 'pdf', 'pptx', 'txt', 'md', 'zip', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp']
        }
      ]
    };
    const selected = owner
      ? await dialog.showOpenDialog(owner, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);
    const selectedPath = selected.filePaths[0];
    if (selected.canceled || !selectedPath) {
      return { ok: false as const, cancelled: true };
    }
    const fileStat = await stat(selectedPath);
    if (!fileStat.isFile() || fileStat.size > 20_000_000) {
      return { ok: false as const, error: '文件无效或超过 20MB' };
    }
    const content = await readFile(selectedPath);
    const mimeByExtension: Record<string, string> = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp'
    };
    const selectedMime = mimeByExtension[path.extname(selectedPath).toLowerCase()] ?? 'application/octet-stream';
    const form = new FormData();
    form.append(
      'file',
      new Blob([content], { type: selectedMime }),
      path.basename(selectedPath)
    );
    const response = await deps.apiClient.request({
      method: 'POST',
      path: `/api/conversations/${encodeURIComponent(
        parsed.data.conversationId
      )}/artifacts`,
      idempotencyKey: `artifact-${Date.now()}`,
      body: form
    });
    if (response.status < 200 || response.status >= 300) {
      return { ok: false as const, error: `上传失败（HTTP ${response.status}）` };
    }
    // apiClient 的 mapWorkbenchResponse 已对 /api/conversations/* 做 camelize，
    // 这里两种命名都兼容，避免上游映射行为变化再次踩坑。
    const body = (response.body ?? {}) as Record<string, unknown>;
    return {
      ok: true as const,
      artifact: {
        artifactId: String(body.artifactId ?? body.artifact_id ?? ''),
        displayName: String(body.displayName ?? body.display_name ?? ''),
        mimeType: (body.mimeType ?? body.mime_type ?? null) as string | null,
        sizeBytes: (body.sizeBytes ?? body.size_bytes ?? null) as number | null,
        sha256: (body.sha256 ?? null) as string | null
      }
    };
  }

  async function handleSelectAndUploadKnowledgeDocument(
    event: Electron.IpcMainInvokeEvent,
    raw: unknown
  ) {
    const parsed = KnowledgeDocumentPickerInputSchema.safeParse(raw);
    if (!parsed.success) return { ok: false as const, error: '知识库参数无效' };
    const owner = BrowserWindow.fromWebContents(event.sender);
    const dialogOptions: OpenDialogOptions = {
      title: '选择知识库文档',
      properties: ['openFile'],
      filters: [{
        name: '知识库文档',
        extensions: ['pdf', 'docx', 'pptx', 'xlsx', 'md', 'markdown', 'txt', 'html', 'htm', 'csv', 'json', 'xml']
      }]
    };
    const selected = owner
      ? await dialog.showOpenDialog(owner, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);
    const selectedPath = selected.filePaths[0];
    if (selected.canceled || !selectedPath) return { ok: false as const, cancelled: true };
    try {
      const fileStat = await stat(selectedPath);
      if (!fileStat.isFile() || fileStat.size <= 0 || fileStat.size > 20_000_000) {
        return { ok: false as const, error: '文件无效、为空或超过 20MB' };
      }
      const content = await readFile(selectedPath);
      const extension = path.extname(selectedPath).toLowerCase();
      const mimeByExtension: Record<string, string> = {
        '.pdf': 'application/pdf',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '.md': 'text/markdown', '.markdown': 'text/markdown', '.txt': 'text/plain',
        '.html': 'text/html', '.htm': 'text/html', '.csv': 'text/csv',
        '.json': 'application/json', '.xml': 'application/xml'
      };
      const mimeType = mimeByExtension[extension];
      if (!mimeType) return { ok: false as const, error: '不支持的知识库文件格式' };
      const form = new FormData();
      form.append('file', new Blob([content], { type: mimeType }), path.basename(selectedPath));
      form.append('knowledge_base_id', parsed.data.knowledgeBaseId);
      const response = await deps.apiClient.request({
        method: 'POST',
        path: '/api/knowledge/documents/file',
        body: form,
        idempotencyKey: `knowledge-file-${Date.now()}`,
        timeoutMs: 180_000
      });
      if (response.status < 200 || response.status >= 300) {
        return { ok: false as const, error: `导入失败（HTTP ${response.status}）` };
      }
      const document = KnowledgeDocumentPickerResultSchema.options[0].shape.document.safeParse(response.body);
      if (!document.success) return { ok: false as const, error: '导入响应格式无效' };
      return { ok: true as const, document: document.data };
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async function handleUploadClipboardImage(
    _event: Electron.IpcMainInvokeEvent,
    raw: unknown
  ) {
    const parsed = ClipboardImageInputSchema.safeParse(raw);
    if (!parsed.success) return { ok: false as const, error: '图片参数无效' };
    try {
      const content = Buffer.from(parsed.data.contentBase64, 'base64');
      if (!content.length || content.length > 15_000_000) {
        return { ok: false as const, error: '图片无效或超过 15MB' };
      }
      const form = new FormData();
      form.append('file', new Blob([content], { type: parsed.data.mimeType }), parsed.data.filename);
      const response = await deps.apiClient.request({
        method: 'POST',
        path: `/api/conversations/${encodeURIComponent(parsed.data.conversationId)}/artifacts`,
        idempotencyKey: `clipboard-artifact-${Date.now()}`,
        body: form
      });
      if (response.status < 200 || response.status >= 300) {
        return { ok: false as const, error: `图片上传失败（HTTP ${response.status}）` };
      }
      const body = (response.body ?? {}) as Record<string, unknown>;
      return {
        ok: true as const,
        artifact: {
          artifactId: String(body.artifactId ?? body.artifact_id ?? ''),
          displayName: String(body.displayName ?? body.display_name ?? parsed.data.filename),
          mimeType: String(body.mimeType ?? body.mime_type ?? parsed.data.mimeType),
          sizeBytes: Number(body.sizeBytes ?? body.size_bytes ?? content.length)
        }
      };
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
    }
  }

  const OpenArtifactFileInputSchema = z.object({
    artifactId: z.string().min(1).max(256),
    mode: z.enum(['open', 'download', 'show-in-folder']).default('open')
  });

  interface DownloadedArtifact {
    tmpPath: string;
    displayName: string;
    bytes: number;
  }

  function artifactTempDir(): string {
    return path.join(tmpdir(), 'enterprise-workbench-artifacts');
  }

  function isPathWithin(root: string, candidate: string): boolean {
    const relative = path.relative(path.resolve(root), path.resolve(candidate));
    return (
      relative === '' ||
      (!relative.startsWith('..') && !path.isAbsolute(relative))
    );
  }

  /**
   * 把 artifact 下载到本地临时文件，返回原始路径 + 文件名 + 字节数。
   * 所有 IPC 通道（打开/下载/转换 PDF）共用这个 helper。
   */
  async function downloadArtifactToTemp(
    artifactId: string
  ): Promise<{ ok: true; data: DownloadedArtifact } | { ok: false; error: string }> {
    const creds = deps.credentialStore.snapshot();
    const apiKey = creds.apiKey;
    const tenantId = creds.tenantId;
    const actorId = creds.actorId;
    if (!apiKey || !tenantId || !actorId) {
      return { ok: false, error: '会话信息缺失：请先在设置中配置 API Key / Tenant / Actor' };
    }
    const baseUrl = (creds.baseUrl || deps.baseUrl()).replace(/\/$/, '');
    const url = `${baseUrl}/api/artifacts/${encodeURIComponent(artifactId)}/content`;
    const headers: Record<string, string> = {
      'X-API-Key': apiKey,
      'X-Tenant-ID': tenantId,
      'X-Actor-ID': actorId
    };
    const role = (creds as { role?: string }).role;
    if (role) headers['X-Role'] = role;
    const res = await fetch(url, { method: 'GET', headers });
    if (!res.ok) {
      return { ok: false, error: `下载失败（HTTP ${res.status}）` };
    }
    const cd = res.headers.get('content-disposition') || '';
    const utf8Name = (() => {
      const utf8Match = cd.match(/filename\*=UTF-8''([^;]+)/i);
      if (utf8Match) return decodeURIComponent(utf8Match[1]);
      const basicMatch = cd.match(/filename="?([^";]+)"?/i);
      if (basicMatch) return basicMatch[1];
      return null;
    })();
    const displayName = utf8Name || `artifact-${artifactId}`;
    const safeName = [...displayName]
      .map((character) =>
        character.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(character)
          ? '_'
          : character
      )
      .join('')
      .slice(0, 80) || 'artifact';
    const arrayBuffer = await res.arrayBuffer();
    const bytes = Buffer.from(arrayBuffer);
    const tmpDir = artifactTempDir();
    await mkdir(tmpDir, { recursive: true });
    const tmpPath = path.join(
      tmpDir,
      `workbench-${artifactId}-${Date.now()}-${safeName}`
    );
    await writeFile(tmpPath, bytes);
    return {
      ok: true,
      data: { tmpPath, displayName, bytes: bytes.length }
    };
  }

  async function handleOpenArtifactFile(
    _event: Electron.IpcMainInvokeEvent,
    raw: unknown
  ): Promise<
    | { ok: true; path: string; mode: 'open' | 'download' | 'show-in-folder' }
    | { ok: false; error: string }
  > {
    const parsed = OpenArtifactFileInputSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.message };
    }
    const { artifactId, mode } = parsed.data;
    try {
      const dl = await downloadArtifactToTemp(artifactId);
      if (!dl.ok) return dl;
      const tmpPath = dl.data.tmpPath;
      if (mode === 'open') {
        const errMsg = await shell.openPath(tmpPath);
        if (errMsg) {
          await shell.openExternal(`file://${tmpPath}`);
        }
      } else if (mode === 'show-in-folder') {
        shell.showItemInFolder(tmpPath);
      } else {
        const owner = BrowserWindow.fromWebContents(_event.sender);
        const result = owner
          ? await dialog.showSaveDialog(owner, { defaultPath: tmpPath })
          : await dialog.showSaveDialog({ defaultPath: tmpPath });
        if (!result.canceled && result.filePath) {
          await copyFile(tmpPath, result.filePath);
        }
      }
      return { ok: true, path: tmpPath, mode };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  const ConvertArtifactInputSchema = z.object({
    artifactId: z.string().min(1).max(256)
  });

  async function handleConvertArtifactToPdf(
    _event: Electron.IpcMainInvokeEvent,
    raw: unknown
  ): Promise<
    | {
        ok: true;
        pdfPath: string;
        sourcePath: string;
        tool: string;
        sizeBytes: number;
      }
    | { ok: false; error: string; support: 'native' | 'convertible' | 'unsupported' }
  > {
    const parsed = ConvertArtifactInputSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.message, support: 'unsupported' };
    }
    try {
      const dl = await downloadArtifactToTemp(parsed.data.artifactId);
      if (!dl.ok) return { ok: false, error: dl.error, support: 'unsupported' };
      const ext = path.extname(dl.data.tmpPath).toLowerCase();
      if (ext === '.pdf') {
        return {
          ok: true,
          pdfPath: dl.data.tmpPath,
          sourcePath: dl.data.tmpPath,
          tool: 'native',
          sizeBytes: dl.data.bytes
        };
      }
      if (!isConversionSupported(dl.data.tmpPath)) {
        return { ok: false, error: `格式 ${ext} 不支持`, support: 'unsupported' };
      }
      if (!hasAvailableTool()) {
        return {
          ok: false,
          error:
            '未找到 LibreOffice。请安装 LibreOffice 以启用 PDF 内嵌预览。',
          support: 'convertible'
        };
      }
      const result = await convertToPdf(dl.data.tmpPath);
      if (!result.ok || !result.pdfPath) {
        return { ok: false, error: result.error || '转换失败', support: 'convertible' };
      }
      return {
        ok: true,
        pdfPath: result.pdfPath,
        sourcePath: dl.data.tmpPath,
        tool: result.tool || 'libreoffice',
        sizeBytes: dl.data.bytes
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        support: 'unsupported'
      };
    }
  }

  function artifactRequestHeaders(): Record<string, string> | null {
    const creds = deps.credentialStore.snapshot();
    if (!creds.apiKey || !creds.tenantId || !creds.actorId) return null;
    const headers: Record<string, string> = {
      'X-API-Key': creds.apiKey,
      'X-Tenant-ID': creds.tenantId,
      'X-Actor-ID': creds.actorId
    };
    const role = (creds as { role?: string }).role;
    if (role) headers['X-Role'] = role;
    return headers;
  }

  async function handleBrowserOpenArtifact(
    _event: Electron.IpcMainInvokeEvent,
    raw: unknown
  ) {
    const parsed = BrowserArtifactInputSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false,
        message: '文件预览参数无效',
        state: deps.browser().getState()
      };
    }
    const headers = artifactRequestHeaders();
    if (!headers) {
      return {
        ok: false,
        message: '会话信息缺失：请先配置连接信息',
        state: deps.browser().getState()
      };
    }
    const baseUrl = deps.credentialStore.snapshot().baseUrl || deps.baseUrl();
    const url = `${baseUrl.replace(/\/$/, '')}/api/artifacts/${encodeURIComponent(
      parsed.data.artifactId
    )}/preview`;
    return deps.browser().openArtifact(
      url,
      headers,
      parsed.data.artifactId,
      parsed.data.displayName
    );
  }

  async function handleExportArtifactPptx(
    event: Electron.IpcMainInvokeEvent,
    raw: unknown
  ): Promise<{ ok: boolean; path?: string; artifactId?: string; error?: string }> {
    const parsed = BrowserArtifactInputSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: '导出参数无效' };
    const headers = artifactRequestHeaders();
    if (!headers) return { ok: false, error: '会话信息缺失：请先配置连接信息' };
    const creds = deps.credentialStore.snapshot();
    const baseUrl = (creds.baseUrl || deps.baseUrl()).replace(/\/$/, '');
    const previewUrl = `${baseUrl}/api/artifacts/${encodeURIComponent(
      parsed.data.artifactId
    )}/preview`;
    const extraHeaders = Object.entries(headers)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n');
    const captureWindow = new BrowserWindow({
      show: false,
      frame: false,
      useContentSize: true,
      width: 1920,
      height: 1080,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
        backgroundThrottling: false,
        partition: 'workbench-slide-export'
      }
    });
    try {
      captureWindow.webContents.session.setPermissionRequestHandler(
        (_contents, _permission, callback) => callback(false)
      );
      captureWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      captureWindow.webContents.session.on('will-download', (downloadEvent) => {
        downloadEvent.preventDefault();
      });
      await captureWindow.loadURL(previewUrl, { extraHeaders });
      const slideCount = (await captureWindow.webContents.executeJavaScript(`(() => {
        const slides = Array.from(document.querySelectorAll('.slide'));
        if (!slides.length) return 0;
        document.documentElement.style.setProperty('width', '1920px', 'important');
        document.documentElement.style.setProperty('height', '1080px', 'important');
        document.documentElement.style.setProperty('overflow', 'hidden', 'important');
        document.body.style.setProperty('width', '1920px', 'important');
        document.body.style.setProperty('height', '1080px', 'important');
        document.body.style.setProperty('margin', '0', 'important');
        document.body.style.setProperty('overflow', 'hidden', 'important');
        const style = document.createElement('style');
        style.textContent = '*{animation-delay:0s!important;animation-duration:0s!important;' +
          'transition-delay:0s!important;transition-duration:0s!important}';
        document.head.appendChild(style);
        const displays = slides.map((slide) => {
          const display = getComputedStyle(slide).display;
          return display === 'none' ? 'block' : display;
        });
        window.__workbenchSetExportSlide = (index) => {
          slides.forEach((slide, slideIndex) => {
            slide.classList.toggle('active', slideIndex === index);
            slide.classList.toggle('visible', slideIndex === index);
            slide.style.setProperty('display', slideIndex === index ? displays[slideIndex] : 'none', 'important');
            slide.style.setProperty('position', 'fixed', 'important');
            slide.style.setProperty('inset', '0', 'important');
            slide.style.setProperty('width', '1920px', 'important');
            slide.style.setProperty('height', '1080px', 'important');
            slide.style.setProperty('margin', '0', 'important');
            slide.style.setProperty('transform', 'none', 'important');
            slide.style.setProperty('opacity', slideIndex === index ? '1' : '0', 'important');
            slide.style.setProperty('visibility', slideIndex === index ? 'visible' : 'hidden', 'important');
          });
          document.getAnimations().forEach((animation) => animation.finish());
        };
        return slides.length;
      })()`)) as number;
      if (!Number.isInteger(slideCount) || slideCount < 1 || slideCount > 100) {
        return { ok: false, error: 'HTML 中未找到有效的 .slide 页面（最多支持 100 页）' };
      }
      await captureWindow.webContents.executeJavaScript(
        'document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()'
      );
      const slidesBase64: string[] = [];
      for (let index = 0; index < slideCount; index += 1) {
        await captureWindow.webContents.executeJavaScript(
          `window.__workbenchSetExportSlide(${index})`
        );
        await new Promise((resolve) => setTimeout(resolve, 40));
        const image = await captureWindow.webContents.capturePage();
        slidesBase64.push(
          image.resize({ width: 1920, height: 1080, quality: 'best' }).toPNG().toString('base64')
        );
      }
      const exportResponse = await fetch(
        `${baseUrl}/api/artifacts/${encodeURIComponent(parsed.data.artifactId)}/export/pptx`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: parsed.data.displayName.replace(/\.html?$/i, ''),
            slides_base64: slidesBase64
          })
        }
      );
      if (!exportResponse.ok) {
        const detail = await exportResponse.text();
        return { ok: false, error: `PPTX 生成失败（HTTP ${exportResponse.status}）：${detail}` };
      }
      const exported = (await exportResponse.json()) as {
        artifact_id?: string;
        artifactId?: string;
      };
      const exportedId = exported.artifactId || exported.artifact_id;
      if (!exportedId) return { ok: false, error: 'PPTX 生成结果缺少 artifact id' };
      const downloaded = await downloadArtifactToTemp(exportedId);
      if (!downloaded.ok) return downloaded;
      const owner = BrowserWindow.fromWebContents(event.sender);
      const result = owner
        ? await dialog.showSaveDialog(owner, {
            defaultPath: downloaded.data.displayName,
            filters: [{ name: 'PowerPoint 演示文稿', extensions: ['pptx'] }]
          })
        : await dialog.showSaveDialog({
            defaultPath: downloaded.data.displayName,
            filters: [{ name: 'PowerPoint 演示文稿', extensions: ['pptx'] }]
          });
      if (result.canceled || !result.filePath) {
        return { ok: true, artifactId: exportedId };
      }
      await copyFile(downloaded.data.tmpPath, result.filePath);
      return { ok: true, path: result.filePath, artifactId: exportedId };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      if (!captureWindow.isDestroyed()) captureWindow.destroy();
    }
  }

  const ReadLocalPdfInputSchema = z.object({
    pdfPath: z.string().min(1).max(4096)
  });

  /**
   * nip.io 泛解析域名 → 裸 IP 的重写。
   *
   * 背景：nip.io 等泛解析域名未 ICP 备案，指向腾讯云大陆 CVM 会被
   * EdgeOne 安全拦截（拦截基于 80/443 的域名 Host 嗅探）。内嵌浏览器
   * 因为走我们自己的网络栈可以绕过，但系统浏览器打开时会真实触发。
   *
   * 规则：``*.119.45.252.25.nip.io`` → ``119.45.252.25:18080``
   * （18080 是裸 IP 非标端口入口，对应 nginx 的第二个 server block）。
   */
  const NIP_SUFFIX = '.119.45.252.25.nip.io';
  const DIRECT_IP_AUTHORITY = '119.45.252.25:18080';

  function maybeRewriteNipToDirectIp(url: string): string {
    try {
      const parsed = new URL(url);
      if (
        parsed.hostname === NIP_SUFFIX.slice(1) || // 精确匹配 119.45.252.25.nip.io
        parsed.hostname.endsWith(NIP_SUFFIX)      // 任意子域名，如 xiaowei.119.45.252.25.nip.io
      ) {
        parsed.host = DIRECT_IP_AUTHORITY;
        return parsed.toString();
      }
      return url;
    } catch {
      return url;
    }
  }

  const OpenExternalUrlInputSchema = z.object({
    url: z
      .string()
      .min(1)
      .max(4096)
      .refine((value) => /^https?:\/\//i.test(value), {
        message: 'url must be http(s)'
      })
  });

  async function handleOpenExternalUrl(
    _event: Electron.IpcMainInvokeEvent,
    raw: unknown
  ): Promise<{ ok: boolean; error?: string }> {
    console.log('[ipc.handleOpenExternalUrl] called', raw);
    const parsed = OpenExternalUrlInputSchema.safeParse(raw);
    if (!parsed.success) {
      console.warn('[ipc.handleOpenExternalUrl] zod failed', parsed.error.message);
      return { ok: false, error: parsed.error.message };
    }
    // nip.io 泛解析域名未备案，大陆访问会被腾讯云 EdgeOne 安全拦截
    // （浏览器被重定向到 dnspod.qcloud.com/static/webblock.html）。
    // 系统浏览器打开时自动替换为裸 IP + 18080 端口，绕开拦截。
    let finalUrl = parsed.data.url;
    // artifact preview 链接在系统浏览器里没有 X-Tenant-ID/X-Actor-ID，
    // 必须补一次性 ?token=，否则外跳后 401。集中在主进程处理，
    // 覆盖 BrowserPanel 与 Markdown 链接点击等所有入口（含带 #fragment
    // 的链接，渲染端正则匹配不到）。补签在 nip 重写前做，两种 origin
    // 形态（域名/裸 IP）都认。
    try {
      const baseUrl = deps.apiClient.getBaseUrl();
      const backendOrigins = [
        new URL(baseUrl).origin,
        new URL(maybeRewriteNipToDirectIp(baseUrl)).origin
      ];
      finalUrl = await withArtifactPreviewToken(
        finalUrl,
        backendOrigins,
        async (artifactId) => {
          const response = await deps.apiClient.request({
            method: 'POST',
            path: `/api/artifacts/${encodeURIComponent(artifactId)}/preview-token`
          });
          if (response.status < 200 || response.status >= 300) {
            throw new Error(`预览 token 申请失败（HTTP ${response.status}）`);
          }
          const body = (response.body ?? {}) as Record<string, unknown>;
          if (typeof body.token !== 'string' || !body.token) {
            throw new Error('预览 token 响应缺少 token 字段');
          }
          return body.token;
        }
      );
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
    finalUrl = maybeRewriteNipToDirectIp(finalUrl);
    try {
      console.log('[ipc.handleOpenExternalUrl] calling shell.openExternal', finalUrl);
      await shell.openExternal(finalUrl);
      console.log('[ipc.handleOpenExternalUrl] success');
      return { ok: true };
    } catch (error) {
      console.error('[ipc.handleOpenExternalUrl] failed', error);
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async function handleReadLocalPdf(
    _event: Electron.IpcMainInvokeEvent,
    raw: unknown
  ): Promise<{ ok: true; dataBase64: string; sizeBytes: number } | { ok: false; error: string }> {
    const parsed = ReadLocalPdfInputSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.message };
    }
    try {
      // 安全检查：只能读取本应用下载/转换目录中的 PDF（防止越权）。
      const normalized = path.resolve(parsed.data.pdfPath);
      const allowedRoots = [
        artifactTempDir(),
        path.join('/tmp', 'workbench-pdf-cache'),
        path.join('/private/tmp', 'workbench-pdf-cache')
      ];
      if (
        path.extname(normalized).toLowerCase() !== '.pdf' ||
        !allowedRoots.some((root) => isPathWithin(root, normalized))
      ) {
        return { ok: false, error: '不允许读取该路径' };
      }
      const fileInfo = await stat(normalized);
      if (!fileInfo.isFile() || fileInfo.size > 100 * 1024 * 1024) {
        return { ok: false, error: 'PDF 文件无效或超过 100MB 限制' };
      }
      const buf = await readFile(normalized);
      return {
        ok: true,
        dataBase64: buf.toString('base64'),
        sizeBytes: buf.length
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  const ReadArtifactContentInputSchema = z.object({
    artifactId: z.string().min(1).max(256)
  });

  async function handleReadArtifactContent(
    _event: Electron.IpcMainInvokeEvent,
    raw: unknown
  ): Promise<{ ok: true; dataBase64: string; sizeBytes: number } | { ok: false; error: string }> {
    const parsed = ReadArtifactContentInputSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.message };
    }
    try {
      const downloaded = await downloadArtifactToTemp(parsed.data.artifactId);
      if (!downloaded.ok) return downloaded;
      if (downloaded.data.bytes > 25 * 1024 * 1024) {
        return { ok: false, error: '文件超过 25MB 内嵌预览限制' };
      }
      const buffer = await readFile(downloaded.data.tmpPath);
      return {
        ok: true,
        dataBase64: buffer.toString('base64'),
        sizeBytes: buffer.length
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  function handleGetSession() {
    const creds = deps.credentialStore.snapshot();
    return {
      tenantId: creds.tenantId ?? '',
      actorId: creds.actorId ?? '',
      baseUrl: creds.baseUrl || deps.baseUrl(),
      hasApiKey: Boolean(creds.apiKey)
    };
  }

  async function handleUpdateSession(event: Electron.IpcMainInvokeEvent, raw: unknown) {
    const parsed = SessionUpdateSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: { code: 'INVALID_INPUT', message: parsed.error.message } };
    }
    const next = parsed.data;
    const existing = deps.credentialStore.snapshot();
    const merged = {
      apiKey: next.apiKey ?? existing.apiKey,
      tenantId: next.tenantId ?? existing.tenantId,
      actorId: next.actorId ?? existing.actorId,
      baseUrl: next.baseUrl ?? existing.baseUrl ?? deps.baseUrl()
    };
    if (!merged.apiKey) {
      return { ok: false, error: { code: 'NO_API_KEY', message: 'apiKey is required' } };
    }
    try {
      const connectionProbe = new ApiClient({
        baseUrl: merged.baseUrl,
        credentials: () => merged,
        maxRetries: 0,
        requestTimeoutMs: 5_000
      });
      const response = await connectionProbe.request({
        method: 'GET',
        path: '/api/context'
      });
      if (response.status < 200 || response.status >= 300) {
        const body = response.body as {
          detail?: unknown;
          error?: { message?: unknown };
        } | null;
        const backendMessage =
          typeof body?.error?.message === 'string'
            ? body.error.message
            : typeof body?.detail === 'string'
              ? body.detail
              : `后端返回 HTTP ${response.status}`;
        return {
          ok: false,
          error: {
            code: 'CONNECTION_FAILED',
            message: `连接验证失败：${backendMessage}`
          }
        };
      }
    } catch (err) {
      return {
        ok: false,
        error: {
          code: 'CONNECTION_FAILED',
          message: `连接验证失败：${err instanceof Error ? err.message : String(err)}`
        }
      };
    }
    try {
      await deps.credentialStore.save(merged);
      // The long-lived client is created during Electron bootstrap. Keep it in
      // sync with the just-validated session so subsequent renderer requests
      // do not continue using the startup URL.
      deps.apiClient.setBaseUrl(merged.baseUrl);
      return {
        ok: true,
        session: {
          tenantId: merged.tenantId ?? '',
          actorId: merged.actorId ?? '',
          baseUrl: merged.baseUrl ?? deps.baseUrl(),
          hasApiKey: Boolean(merged.apiKey)
        }
      };
    } catch (err) {
      return {
        ok: false,
        error: {
          code: 'PERSIST_FAILED',
          message: `保存配置失败：${err instanceof Error ? err.message : String(err)}`
        }
      };
    }
  }

  async function handleSendEmailVerificationCode(
    _event: Electron.IpcMainInvokeEvent,
    raw: unknown
  ) {
    const parsed = EmailCodeRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false,
        error: { code: 'INVALID_INPUT', message: parsed.error.message }
      };
    }
    const candidate = new ApiClient({
      baseUrl: parsed.data.baseUrl,
      credentials: () => ({
        apiKey: null,
        tenantId: null,
        actorId: null,
        baseUrl: parsed.data.baseUrl
      }),
      maxRetries: 0,
      requestTimeoutMs: 10_000
    });
    try {
      const response = await candidate.request<{
        ok?: boolean;
        expires_in_seconds?: number;
        retry_after_seconds?: number;
        error?: { code?: string; message?: string; retry_after_seconds?: number };
      }>({
        method: 'POST',
        path: '/api/auth/email-code',
        body: { email: parsed.data.email }
      });
      if (response.status >= 400 || !response.body?.ok) {
        const err = response.body?.error;
        return {
          ok: false,
          error: {
            code: err?.code ?? 'AUTH_FAILED',
            message:
              typeof err?.message === 'string'
                ? err.message
                : `请求验证码失败（HTTP ${response.status}）`,
            retry_after_seconds: err?.retry_after_seconds
          }
        };
      }
      const data = EmailCodeResponseSchema.safeParse(response.body);
      if (!data.success) {
        return {
          ok: false,
          error: { code: 'INVALID_AUTH_RESPONSE', message: '服务端返回了无效的验证码响应' }
        };
      }
      return {
        ok: true,
        expires_in_seconds: data.data.expires_in_seconds,
        retry_after_seconds: data.data.retry_after_seconds
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: 'CONNECTION_FAILED',
          message: `无法连接服务：${error instanceof Error ? error.message : String(error)}`
        }
      };
    }
  }

  async function handleAuthenticateSession(
    _event: Electron.IpcMainInvokeEvent,
    raw: unknown
  ) {
    const parsed = AccountAuthenticationSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false,
        error: { code: 'INVALID_INPUT', message: parsed.error.message }
      };
    }
    const input = parsed.data;
    const candidate = new ApiClient({
      baseUrl: input.baseUrl,
      credentials: () => ({ apiKey: null, tenantId: null, actorId: null, baseUrl: input.baseUrl }),
      maxRetries: 0,
      requestTimeoutMs: 10_000
    });
    try {
      const response = await candidate.request<{
        accessToken?: string;
        access_token?: string;
        session?: {
          tenantId?: string;
          tenant_id?: string;
          actorId?: string;
          actor_id?: string;
        };
        detail?: string;
      }>({
        method: 'POST',
        path: input.mode === 'signup' ? '/api/auth/signup' : '/api/auth/login',
        body: {
          email: input.email,
          password: input.password,
          ...(input.mode === 'signup' ? { display_name: input.displayName } : {}),
          ...(input.mode === 'signup' && input.verificationCode
            ? { verification_code: input.verificationCode }
            : {})
        }
      });
      if (response.status < 200 || response.status >= 300) {
        const body = response.body;
        return {
          ok: false,
          error: {
            code: response.status === 401 ? 'INVALID_CREDENTIALS' : 'AUTH_FAILED',
            message: typeof body?.detail === 'string' ? body.detail : `登录失败（HTTP ${response.status}）`
          }
        };
      }
      const token = response.body.accessToken ?? response.body.access_token;
      const tenantId = response.body.session?.tenantId ?? response.body.session?.tenant_id;
      const actorId = response.body.session?.actorId ?? response.body.session?.actor_id;
      if (!token || !tenantId || !actorId) {
        return {
          ok: false,
          error: { code: 'INVALID_AUTH_RESPONSE', message: '服务端返回了无效的登录信息' }
        };
      }
      const credentials = {
        apiKey: token,
        tenantId,
        actorId,
        baseUrl: input.baseUrl.replace(/\/$/, '')
      };
      await deps.credentialStore.save(credentials);
      deps.apiClient.setBaseUrl(credentials.baseUrl);
      return {
        ok: true,
        session: {
          tenantId,
          actorId,
          baseUrl: credentials.baseUrl,
          hasApiKey: true
        }
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: 'CONNECTION_FAILED',
          message: `无法连接服务：${error instanceof Error ? error.message : String(error)}`
        }
      };
    }
  }

  async function handleLogoutSession() {
    try {
      await deps.apiClient.request({ method: 'POST', path: '/api/auth/logout' });
    } catch {
      // Local sign-out must still work when the service is unreachable.
    }
    await deps.credentialStore.clear();
    return { ok: true };
  }

  function handleSubscribeAnomalies(event: Electron.IpcMainInvokeEvent) {
    const wc: WebContents = event.sender;
    subscriptions.cancel(wc.id);

    const controller = new AbortController();
    subscriptions.add(wc.id, controller);

    const stream = new AnomalyEventStream(deps.baseUrl(), () => deps.credentialStore.snapshot());
    const inner = stream.open((e) => {
      const validated = AnomalyStreamEventSchema.safeParse(e.payload);
      if (!validated.success) return;
      if (!wc.isDestroyed()) {
        wc.send(IpcChannels.AnomalyEvent, validated.data);
      }
    }, controller.signal);

    // Stop the inner stream if the outer one aborts.
    controller.signal.addEventListener('abort', () => inner.abort(), { once: true });

    return { ok: true };
  }

  function handleUnsubscribeAnomalies(event: Electron.IpcMainInvokeEvent) {
    subscriptions.cancel(event.sender.id);
    return { ok: true };
  }

  function handleBrowserSetVisible(
    _event: Electron.IpcMainInvokeEvent,
    visible: unknown
  ) {
    if (typeof visible !== 'boolean') {
      return deps.browser().getState();
    }
    return deps.browser().setVisible(visible);
  }

  function handleBrowserSetBounds(
    _event: Electron.IpcMainInvokeEvent,
    raw: unknown
  ) {
    const parsed = BrowserBoundsSchema.safeParse(raw);
    if (!parsed.success) return deps.browser().getState();
    return deps.browser().setBounds(parsed.data);
  }

  async function handleBrowserNavigate(
    _event: Electron.IpcMainInvokeEvent,
    raw: unknown
  ) {
    const parsed = BrowserNavigateInputSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false,
        message: '请输入有效的 HTTP 或 HTTPS 地址',
        state: deps.browser().getState()
      };
    }
    return deps.browser().navigate(parsed.data.url);
  }

  async function handleBrowserAction(
    _event: Electron.IpcMainInvokeEvent,
    raw: unknown
  ) {
    const parsed = BrowserActionSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false,
        message: '浏览器操作参数无效',
        state: deps.browser().getState()
      };
    }
    return deps.browser().execute(parsed.data);
  }

  // 客户端更新检查：Check 返回最新状态（设置页「检查更新」按钮用），
  // open-download 的 URL 白名单校验在 UpdateChecker 内部完成，渲染端不传 URL。
  function handleGetAppUpdateState() {
    return deps.updateChecker().getState();
  }

  async function handleCheckAppUpdate() {
    return deps.updateChecker().check();
  }

  async function handleOpenAppUpdateDownload() {
    try {
      await deps.updateChecker().openDownload();
      return { ok: true as const };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
    }
  }

  return {
    install() {
      ipcMain.handle(IpcChannels.Request, handleRequest);
      ipcMain.handle(IpcChannels.StartAssistantStream, handleStartAssistantStream);
      ipcMain.handle(IpcChannels.CancelAssistantStream, handleCancelAssistantStream);
      ipcMain.handle(IpcChannels.OpenVerificationArtifact, handleOpenArtifact);
      ipcMain.handle(IpcChannels.GetSession, handleGetSession);
      ipcMain.handle(IpcChannels.UpdateSession, handleUpdateSession);
      ipcMain.handle(IpcChannels.AuthenticateSession, handleAuthenticateSession);
      ipcMain.handle(IpcChannels.LogoutSession, handleLogoutSession);
      ipcMain.handle(IpcChannels.SendEmailVerificationCode, handleSendEmailVerificationCode);
      ipcMain.handle(IpcChannels.SelectAndUploadArtifact, handleSelectAndUploadArtifact);
      ipcMain.handle(IpcChannels.SelectAndUploadKnowledgeDocument, handleSelectAndUploadKnowledgeDocument);
      ipcMain.handle(IpcChannels.UploadClipboardImage, handleUploadClipboardImage);
      ipcMain.handle(IpcChannels.OpenArtifactFile, handleOpenArtifactFile);
      ipcMain.handle(IpcChannels.DownloadArtifact, handleOpenArtifactFile);
      ipcMain.handle(IpcChannels.ConvertArtifactToPdf, handleConvertArtifactToPdf);
      ipcMain.handle(IpcChannels.ReadLocalPdf, handleReadLocalPdf);
      ipcMain.handle(IpcChannels.ReadArtifactContent, handleReadArtifactContent);
      ipcMain.handle(IpcChannels.OpenExternalUrl, handleOpenExternalUrl);
      ipcMain.handle(IpcChannels.SubscribeAnomalies, handleSubscribeAnomalies);
      ipcMain.handle(IpcChannels.UnsubscribeAnomalies, handleUnsubscribeAnomalies);
      ipcMain.handle(IpcChannels.BrowserGetState, () => deps.browser().getState());
      ipcMain.handle(IpcChannels.BrowserSetVisible, handleBrowserSetVisible);
      ipcMain.handle(IpcChannels.BrowserSetBounds, handleBrowserSetBounds);
      ipcMain.handle(IpcChannels.BrowserNavigate, handleBrowserNavigate);
      ipcMain.handle(IpcChannels.BrowserOpenArtifact, handleBrowserOpenArtifact);
      ipcMain.handle(IpcChannels.BrowserAction, handleBrowserAction);
      ipcMain.handle(IpcChannels.ExportArtifactPptx, handleExportArtifactPptx);
      ipcMain.handle(IpcChannels.SubscribeBrowserState, () => deps.browser().getState());
      ipcMain.handle(IpcChannels.UnsubscribeBrowserState, () => ({ ok: true }));
      ipcMain.handle(IpcChannels.GetAppUpdateState, handleGetAppUpdateState);
      ipcMain.handle(IpcChannels.CheckAppUpdate, handleCheckAppUpdate);
      ipcMain.handle(IpcChannels.OpenAppUpdateDownload, handleOpenAppUpdateDownload);
    },
    uninstall() {
      subscriptions.cancelAll();
      assistantStreams.cancelAll();
      for (const channel of Object.values(IpcChannels)) {
        ipcMain.removeHandler(channel);
      }
    }
  };
}

/**
 * Block navigation, new windows, and remote content. Returns a teardown fn.
 * Must be installed before any BrowserWindow loads its renderer.
 */
export function installSecurityGuards(window: BrowserWindow): () => void {
  const blockAttach = (event: Electron.Event, _wc: WebContents) => {
    void _wc;
    event.preventDefault();
  };
  const willNavigate = (event: Electron.Event, url: string) => {
    if (!url.startsWith('file://')) event.preventDefault();
  };
  window.webContents.on('will-navigate', willNavigate);
  window.webContents.on('will-redirect', willNavigate);
  // `will-attach-webview` is not in @types/electron's strict literal set; cast
  // to the generic EventEmitter signature. webviewTag is disabled in
  // webPreferences as a defense-in-depth measure.
  (window.webContents as unknown as {
    on: (event: string, listener: (...args: unknown[]) => void) => void;
    removeListener: (event: string, listener: (...args: unknown[]) => void) => void;
  }).on('will-attach-webview', blockAttach as (...args: unknown[]) => void);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' as const }));
  return () => {
    (window.webContents as unknown as {
      removeListener: (event: string, listener: (...args: unknown[]) => void) => void;
    }).removeListener('will-attach-webview', blockAttach as (...args: unknown[]) => void);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' as const }));
  };
}
