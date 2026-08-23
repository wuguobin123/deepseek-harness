/**
 * Preload bridge.
 *
 * The renderer only sees `window.workbenchApi` and nothing else. No
 * `ipcRenderer`, no `require`, no `process` access. Every method validates
 * its input against a shared Zod schema before sending IPC.
 *
 * Run inside the Electron preload sandbox. Cannot use Node modules beyond
 * `electron`.
 */
import { contextBridge, ipcRenderer } from 'electron';
import {
  IpcChannels,
  AssistantStreamEventSchema,
  AssistantStreamInputSchema,
  AppUpdateStateSchema,
  RequestInputSchema,
  SessionUpdateSchema,
  AccountAuthenticationSchema,
  AnomalyStreamEventSchema,
  ArtifactPickerInputSchema,
  ArtifactPickerResultSchema,
  ClipboardImageInputSchema,
  KnowledgeDocumentPickerInputSchema,
  KnowledgeDocumentPickerResultSchema,
  BrowserArtifactInputSchema,
  BrowserActionResultSchema,
  BrowserActionSchema,
  BrowserBoundsSchema,
  BrowserNavigateInputSchema,
  BrowserStateSchema,
  EmailCodeRequestSchema,
  type AnomalyStreamEvent,
  type AppUpdateState,
  type AssistantStreamEvent,
  type AssistantStreamInput,
  type ArtifactPickerResult,
  type KnowledgeDocumentPickerResult,
  type BrowserArtifactInput,
  type BrowserAction,
  type BrowserActionResult,
  type BrowserBounds,
  type BrowserState,
  type RequestInput,
  type RequestResponse,
  type SessionState,
  type SessionUpdate,
  type AccountAuthentication,
  type EmailCodeRequest,
  type EmailCodeResponse,
  type VerificationOpenResult,
  WORKBENCH_API_KEYS
} from '../shared/contracts';

const allowedChannels: ReadonlySet<string> = new Set(Object.values(IpcChannels));

function ensureChannel(channel: string): void {
  if (!allowedChannels.has(channel)) {
    throw new Error(`channel "${channel}" is not in the workbench API`);
  }
}

function listenToRenderer(channel: string): void {
  ensureChannel(channel);
}

const api = {
  /**
   * Send a typed HTTP request via the main process. The API Key never leaves
   * the main process; the renderer only sees the response body.
   */
  async request(input: RequestInput): Promise<RequestResponse> {
    const parsed = RequestInputSchema.safeParse(input);
    if (!parsed.success) {
      return {
        status: 400,
        body: { error: { code: 'INVALID_INPUT', message: parsed.error.message } }
      };
    }
    return ipcRenderer.invoke(IpcChannels.Request, parsed.data);
  },

  async streamAssistant(
    input: AssistantStreamInput,
    listener: (event: AssistantStreamEvent) => void
  ): Promise<() => void> {
    const parsed = AssistantStreamInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new TypeError(parsed.error.message);
    }
    if (typeof listener !== 'function') {
      throw new TypeError('listener must be a function');
    }
    const channel = IpcChannels.AssistantStreamEvent;
    listenToRenderer(channel);
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      ipcRenderer.removeListener(channel, handler);
      void ipcRenderer.invoke(
        IpcChannels.CancelAssistantStream,
        parsed.data.requestId
      );
    };
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: unknown
    ) => {
      if (
        !payload ||
        typeof payload !== 'object' ||
        (payload as { requestId?: unknown }).requestId !== parsed.data.requestId
      ) {
        return;
      }
      const streamEvent = AssistantStreamEventSchema.safeParse(
        (payload as { event?: unknown }).event
      );
      if (!streamEvent.success) return;
      listener(streamEvent.data);
      if (
        streamEvent.data.type === 'completed' ||
        streamEvent.data.type === 'error'
      ) {
        close();
      }
    };
    ipcRenderer.on(channel, handler);
    const started = (await ipcRenderer.invoke(
      IpcChannels.StartAssistantStream,
      parsed.data
    )) as { ok: boolean; error?: { message?: string } };
    if (!started.ok) {
      close();
      throw new Error(started.error?.message || 'failed to start assistant stream');
    }
    return close;
  },

  /**
   * Subscribe to typed anomaly events. Returns an unsubscribe function.
   * The stream is proxied in the main process; the renderer never touches
   * EventSource directly.
   */
  async subscribeAnomalies(listener: (event: AnomalyStreamEvent) => void): Promise<() => void> {
    if (typeof listener !== 'function') {
      throw new TypeError('listener must be a function');
    }
    await ipcRenderer.invoke(IpcChannels.SubscribeAnomalies);

    const channel = IpcChannels.AnomalyEvent;
    listenToRenderer(channel);

    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      const validated = AnomalyStreamEventSchema.safeParse(payload);
      if (!validated.success) return;
      listener(validated.data);
    };

    ipcRenderer.on(channel, handler);

    return () => {
      ipcRenderer.removeListener(channel, handler);
      void ipcRenderer.invoke(IpcChannels.UnsubscribeAnomalies);
    };
  },

  /**
   * Request the main process to open a verified verification artifact. The
   * main process will re-validate with the backend via
   * `POST /api/verification-artifacts/{id}/open` and only call
   * `shell.openExternal` if the backend authorizes it.
   */
  async openVerificationArtifact(artifactId: string): Promise<VerificationOpenResult | null> {
    if (typeof artifactId !== 'string' || artifactId.length === 0 || artifactId.length > 256) {
      throw new TypeError('artifactId must be a non-empty string up to 256 chars');
    }
    const res = (await ipcRenderer.invoke(IpcChannels.OpenVerificationArtifact, artifactId)) as
      | { ok: true; url: string; expiresAt: string }
      | { ok: false; error: { code: string; message: string } };
    if (!res.ok) return null;
    return { url: res.url, expiresAt: res.expiresAt, traceId: '' };
  },

  async getSession(): Promise<SessionState> {
    const session = (await ipcRenderer.invoke(IpcChannels.GetSession)) as SessionState;
    return session;
  },

  async updateSession(input: SessionUpdate): Promise<{ ok: boolean; session?: SessionState; error?: { code: string; message: string } }> {
    const parsed = SessionUpdateSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: { code: 'INVALID_INPUT', message: parsed.error.message } };
    }
    return ipcRenderer.invoke(IpcChannels.UpdateSession, parsed.data) as Promise<{ ok: boolean; session?: SessionState; error?: { code: string; message: string } }>;
  },

  async authenticateSession(input: AccountAuthentication): Promise<{ ok: boolean; session?: SessionState; error?: { code: string; message: string } }> {
    const parsed = AccountAuthenticationSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: { code: 'INVALID_INPUT', message: parsed.error.message } };
    }
    return ipcRenderer.invoke(IpcChannels.AuthenticateSession, parsed.data) as Promise<{ ok: boolean; session?: SessionState; error?: { code: string; message: string } }>;
  },

  async sendEmailVerificationCode(input: EmailCodeRequest): Promise<
    | EmailCodeResponse
    | { ok: false; error: { code: string; message: string; retry_after_seconds?: number } }
  > {
    const parsed = EmailCodeRequestSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: { code: 'INVALID_INPUT', message: parsed.error.message } };
    }
    return ipcRenderer.invoke(IpcChannels.SendEmailVerificationCode, parsed.data) as Promise<
      | EmailCodeResponse
      | { ok: false; error: { code: string; message: string; retry_after_seconds?: number } }
    >;
  },

  async logoutSession(): Promise<{ ok: boolean }> {
    return ipcRenderer.invoke(IpcChannels.LogoutSession) as Promise<{ ok: boolean }>;
  },

  async selectAndUploadArtifact(conversationId: string): Promise<ArtifactPickerResult> {
    const input = ArtifactPickerInputSchema.parse({ conversationId });
    const result = await ipcRenderer.invoke(
      IpcChannels.SelectAndUploadArtifact,
      input
    );
    return ArtifactPickerResultSchema.parse(result);
  },

  async selectAndUploadKnowledgeDocument(
    knowledgeBaseId: string
  ): Promise<KnowledgeDocumentPickerResult> {
    const input = KnowledgeDocumentPickerInputSchema.parse({ knowledgeBaseId });
    const result = await ipcRenderer.invoke(
      IpcChannels.SelectAndUploadKnowledgeDocument,
      input
    );
    return KnowledgeDocumentPickerResultSchema.parse(result);
  },

  async uploadClipboardImage(input: {
    conversationId: string;
    filename: string;
    mimeType: string;
    contentBase64: string;
  }): Promise<ArtifactPickerResult> {
    const parsed = ClipboardImageInputSchema.parse(input);
    const result = await ipcRenderer.invoke(IpcChannels.UploadClipboardImage, parsed);
    return ArtifactPickerResultSchema.parse(result);
  },

  async openArtifactFile(
    artifactId: string,
    mode: 'open' | 'download' | 'show-in-folder' = 'open'
  ): Promise<{ ok: boolean; path?: string; error?: string }> {
    if (typeof artifactId !== 'string' || artifactId.length === 0) {
      throw new TypeError('artifactId must be a non-empty string');
    }
    return ipcRenderer.invoke(IpcChannels.OpenArtifactFile, { artifactId, mode });
  },

  async downloadArtifactFile(artifactId: string): Promise<{
    ok: boolean;
    path?: string;
    error?: string;
  }> {
    if (typeof artifactId !== 'string' || artifactId.length === 0) {
      throw new TypeError('artifactId must be a non-empty string');
    }
    return ipcRenderer.invoke(IpcChannels.DownloadArtifact, {
      artifactId,
      mode: 'download'
    });
  },

  async openExternalUrl(url: string): Promise<{ ok: boolean; error?: string }> {
    if (typeof url !== 'string' || url.length === 0) {
      throw new TypeError('url must be a non-empty string');
    }
    if (!/^https?:\/\//i.test(url)) {
      throw new TypeError('url must be http(s)');
    }
    return ipcRenderer.invoke(IpcChannels.OpenExternalUrl, { url });
  },

  async requestArtifactPreviewToken(input: {
    artifactId: string;
  }): Promise<RequestResponse> {
    if (typeof input?.artifactId !== 'string' || input.artifactId.length === 0) {
      throw new TypeError('artifactId must be a non-empty string');
    }
    // 复用通用 request IPC：调用 POST /api/artifacts/{id}/preview-token，
    // 鉴权由 main 进程的 dev-bridge / credentialStore 自动附加 X-Tenant-ID 等 header。
    return ipcRenderer.invoke(IpcChannels.Request, {
      method: 'POST',
      path: `/api/artifacts/${encodeURIComponent(input.artifactId)}/preview-token`
    });
  },

  async convertArtifactToPdf(artifactId: string): Promise<
    | {
        ok: true;
        pdfPath: string;
        sourcePath: string;
        tool: string;
        sizeBytes: number;
      }
    | { ok: false; error: string; support: 'native' | 'convertible' | 'unsupported' }
  > {
    if (typeof artifactId !== 'string' || artifactId.length === 0) {
      throw new TypeError('artifactId must be a non-empty string');
    }
    return ipcRenderer.invoke(IpcChannels.ConvertArtifactToPdf, { artifactId });
  },

  async readLocalPdf(pdfPath: string): Promise<
    { ok: true; dataBase64: string; sizeBytes: number } | { ok: false; error: string }
  > {
    if (typeof pdfPath !== 'string' || pdfPath.length === 0) {
      throw new TypeError('pdfPath must be a non-empty string');
    }
    return ipcRenderer.invoke(IpcChannels.ReadLocalPdf, { pdfPath });
  },

  async readArtifactContent(artifactId: string): Promise<
    { ok: true; dataBase64: string; sizeBytes: number } | { ok: false; error: string }
  > {
    if (typeof artifactId !== 'string' || artifactId.length === 0) {
      throw new TypeError('artifactId must be a non-empty string');
    }
    return ipcRenderer.invoke(IpcChannels.ReadArtifactContent, { artifactId });
  },

  async browserGetState(): Promise<BrowserState> {
    const state = await ipcRenderer.invoke(IpcChannels.BrowserGetState);
    return BrowserStateSchema.parse(state);
  },

  async browserSetVisible(visible: boolean): Promise<BrowserState> {
    if (typeof visible !== 'boolean') throw new TypeError('visible must be a boolean');
    const state = await ipcRenderer.invoke(IpcChannels.BrowserSetVisible, visible);
    return BrowserStateSchema.parse(state);
  },

  async browserSetBounds(bounds: BrowserBounds): Promise<BrowserState> {
    const parsed = BrowserBoundsSchema.parse(bounds);
    const state = await ipcRenderer.invoke(IpcChannels.BrowserSetBounds, parsed);
    return BrowserStateSchema.parse(state);
  },

  async browserNavigate(url: string): Promise<BrowserActionResult> {
    const parsed = BrowserNavigateInputSchema.parse({ url });
    const result = await ipcRenderer.invoke(IpcChannels.BrowserNavigate, parsed);
    return BrowserActionResultSchema.parse(result);
  },

  async browserOpenArtifact(input: BrowserArtifactInput): Promise<BrowserActionResult> {
    const parsed = BrowserArtifactInputSchema.parse(input);
    const result = await ipcRenderer.invoke(IpcChannels.BrowserOpenArtifact, parsed);
    return BrowserActionResultSchema.parse(result);
  },

  async exportArtifactToPptx(input: BrowserArtifactInput): Promise<{
    ok: boolean;
    path?: string;
    artifactId?: string;
    error?: string;
  }> {
    const parsed = BrowserArtifactInputSchema.parse(input);
    return ipcRenderer.invoke(IpcChannels.ExportArtifactPptx, parsed);
  },

  async browserAction(action: BrowserAction): Promise<BrowserActionResult> {
    const parsed = BrowserActionSchema.parse(action);
    const result = await ipcRenderer.invoke(IpcChannels.BrowserAction, parsed);
    return BrowserActionResultSchema.parse(result);
  },

  async subscribeBrowserState(
    listener: (state: BrowserState) => void
  ): Promise<() => void> {
    if (typeof listener !== 'function') {
      throw new TypeError('listener must be a function');
    }
    const initial = await ipcRenderer.invoke(IpcChannels.SubscribeBrowserState);
    listener(BrowserStateSchema.parse(initial));

    const channel = IpcChannels.BrowserStateEvent;
    listenToRenderer(channel);
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      const parsed = BrowserStateSchema.safeParse(payload);
      if (parsed.success) listener(parsed.data);
    };
    ipcRenderer.on(channel, handler);
    return () => {
      ipcRenderer.removeListener(channel, handler);
      void ipcRenderer.invoke(IpcChannels.UnsubscribeBrowserState);
    };
  },

  async getAppUpdateState(): Promise<AppUpdateState> {
    const state = await ipcRenderer.invoke(IpcChannels.GetAppUpdateState);
    return AppUpdateStateSchema.parse(state);
  },

  async checkAppUpdate(): Promise<AppUpdateState> {
    const state = await ipcRenderer.invoke(IpcChannels.CheckAppUpdate);
    return AppUpdateStateSchema.parse(state);
  },

  async openAppUpdateDownload(): Promise<{ ok: boolean; error?: string }> {
    return ipcRenderer.invoke(IpcChannels.OpenAppUpdateDownload) as Promise<{
      ok: boolean;
      error?: string;
    }>;
  },

  async subscribeAppUpdateState(
    listener: (state: AppUpdateState) => void
  ): Promise<() => void> {
    if (typeof listener !== 'function') {
      throw new TypeError('listener must be a function');
    }
    const initial = await ipcRenderer.invoke(IpcChannels.GetAppUpdateState);
    listener(AppUpdateStateSchema.parse(initial));

    const channel = IpcChannels.AppUpdateStateEvent;
    listenToRenderer(channel);
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      const parsed = AppUpdateStateSchema.safeParse(payload);
      if (parsed.success) listener(parsed.data);
    };
    ipcRenderer.on(channel, handler);
    return () => {
      ipcRenderer.removeListener(channel, handler);
    };
  }
};

// Lock down the bridge: expose exactly the keys from the contract.
type WorkbenchApi = typeof api;
const exposed: Partial<WorkbenchApi> = {};
for (const key of WORKBENCH_API_KEYS) {
  const value = (api as unknown as Record<string, unknown>)[key];
  if (typeof value === 'function') {
    exposed[key as keyof WorkbenchApi] = value as never;
  }
}

contextBridge.exposeInMainWorld('workbenchApi', exposed);

export type { WorkbenchApi };
