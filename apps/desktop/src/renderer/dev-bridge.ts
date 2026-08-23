/**
 * Dev-mode bridge for the renderer.
 *
 * The Electron main process owns the typed ``window.workbenchApi`` bridge
 * via the preload script. When the renderer is served by Vite (no main
 * process), we install a stand-in that talks to the backend directly
 * via ``fetch`` and ``EventSource`` so the rest of the UI is exercisable
 * end-to-end from a browser.
 *
 * Security note: this is a development convenience only. The mock
 * uses the configured session API key from the renderer (it is *not*
 * stored in safeStorage; that path only runs in the packaged app).
 */

import type {
  Anomaly,
  AnomalyListResponse,
  AnomalyStreamEvent,
  AssistantStreamEvent,
  AssistantStreamInput,
  BrowserAction,
  BrowserActionResult,
  BrowserArtifactInput,
  BrowserBounds,
  BrowserState,
  KnowledgeDocumentPickerResult,
  RequestInput,
  RequestResponse,
  SessionState,
  SessionUpdate,
  Trigger,
  TriggerListResponse,
  VerificationOpenResult
} from '../shared/contracts';
import { AssistantStreamEventSchema } from '../shared/contracts';
import { mapWorkbenchResponse } from '../main/wire-mappers';

type WorkbenchApi = {
  request: (input: RequestInput) => Promise<RequestResponse>;
  streamAssistant: (
    input: AssistantStreamInput,
    listener: (event: AssistantStreamEvent) => void
  ) => Promise<() => void>;
  subscribeAnomalies: (listener: (event: AnomalyStreamEvent) => void) => Promise<() => void>;
  openVerificationArtifact: (artifactId: string) => Promise<VerificationOpenResult | null>;
  getSession: () => Promise<SessionState>;
  updateSession: (
    input: SessionUpdate
  ) => Promise<{ ok: boolean; session?: SessionState; error?: { code: string; message: string } }>;
  browserGetState: () => Promise<BrowserState>;
  browserSetVisible: (visible: boolean) => Promise<BrowserState>;
  browserSetBounds: (bounds: BrowserBounds) => Promise<BrowserState>;
  browserNavigate: (url: string) => Promise<BrowserActionResult>;
  browserOpenArtifact: (input: BrowserArtifactInput) => Promise<BrowserActionResult>;
  openExternalUrl: (url: string) => Promise<{ ok: boolean; error?: string }>;
  requestArtifactPreviewToken: (input: {
    artifactId: string;
  }) => Promise<{ ok: true; token: string; expiresAt: number } | { ok: false; error: string }>;
  exportArtifactToPptx: (input: BrowserArtifactInput) => Promise<{
    ok: boolean;
    path?: string;
    artifactId?: string;
    error?: string;
  }>;
  browserAction: (action: BrowserAction) => Promise<BrowserActionResult>;
  subscribeBrowserState: (
    listener: (state: BrowserState) => void
  ) => Promise<() => void>;
  readArtifactContent: (artifactId: string) => Promise<
    { ok: true; dataBase64: string; sizeBytes: number } | { ok: false; error: string }
  >;
  selectAndUploadKnowledgeDocument: (knowledgeBaseId: string) => Promise<KnowledgeDocumentPickerResult>;
};

type AnomalySeverity = 'low' | 'medium' | 'high' | 'critical';
type AnomalyStatus =
  | 'pending'
  | 'fixing'
  | 'awaiting_approval'
  | 'verifying'
  | 'resolved'
  | 'ignored';

const SESSION_KEY = 'workbench.dev.session';
const API_KEY_SESSION_KEY = 'workbench.dev.api-key';

const DEFAULT_SESSION: SessionState = {
  tenantId: '',
  actorId: '',
  baseUrl: 'http://127.0.0.1:8000',
  hasApiKey: false
};

function loadSession(): SessionState {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return { ...DEFAULT_SESSION };
    const loaded = {
      ...DEFAULT_SESSION,
      ...(JSON.parse(raw) as Partial<SessionState>)
    };
    const normalizedBaseUrl = loaded.baseUrl.replace(/\/$/, '');
    const baseUrl = [
      'http://127.0.0.1:8080',
      'http://localhost:8080',
      'http://127.0.0.1:8001',
      'http://localhost:8001'
    ].includes(normalizedBaseUrl)
      ? DEFAULT_SESSION.baseUrl
      : loaded.baseUrl;
    const migrated = {
      ...loaded,
      baseUrl,
      actorId: loaded.actorId === 'sup-1' ? DEFAULT_SESSION.actorId : loaded.actorId
    };
    if (
      migrated.baseUrl !== loaded.baseUrl ||
      migrated.actorId !== loaded.actorId
    ) {
      saveSession(migrated);
    }
    return migrated;
  } catch {
    return { ...DEFAULT_SESSION };
  }
}

function saveSession(session: SessionState): void {
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function loadDevApiKey(): string {
  return window.sessionStorage.getItem(API_KEY_SESSION_KEY) || '';
}

function saveDevApiKey(apiKey: string): void {
  window.sessionStorage.setItem(API_KEY_SESSION_KEY, apiKey);
}

function sessionHeaders(session: SessionState): Record<string, string> {
  return {
    'X-Tenant-ID': session.tenantId,
    'X-Actor-ID': session.actorId,
    'X-Actor-Role': 'supervisor',
    'X-Team-ID': 'team-1',
    'X-Actor-Name': session.actorId
  };
}

// ---------------------------------------------------------------------------
// Wire format translation
// ---------------------------------------------------------------------------
// The backend speaks Python-style snake_case; the renderer uses
// camelCase types from ``@shared/contracts``. The dev bridge maps the
// wire shape into the typed renderer shape so the contract tests in
// ``tests/preload-contract.test.ts`` keep matching the typed Zod
// schemas. The production main process performs the same mapping on
// the IPC payload before forwarding to the renderer.

function asAnomalyStatus(value: unknown): AnomalyStatus {
  if (
    value === 'pending' ||
    value === 'fixing' ||
    value === 'awaiting_approval' ||
    value === 'verifying' ||
    value === 'resolved' ||
    value === 'ignored'
  ) {
    return value;
  }
  return 'pending';
}

function asAnomalySeverity(value: unknown): AnomalySeverity {
  if (
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'critical'
  ) {
    return value;
  }
  return 'medium';
}

function mapAnomaly(row: Record<string, unknown>): Anomaly {
  return {
    anomalyId: String(row.anomaly_id ?? ''),
    title: String(row.title ?? ''),
    description: String(row.description ?? ''),
    severity: asAnomalySeverity(row.severity),
    status: asAnomalyStatus(row.status),
    sourcePlugin: String(row.source_plugin ?? ''),
    sourceCapability: String(row.source_capability ?? ''),
    ownerActorId: (row.owner_actor_id as string | null) ?? null,
    occurrenceCount: Number(row.occurrence_count ?? 1),
    firstSeenAt: String(row.first_seen_at ?? ''),
    lastSeenAt: String(row.last_seen_at ?? ''),
    deepLink: (row.deep_link as string | null) ?? null,
    version: Number(row.version ?? 1)
  };
}

function mapAnomalyDetail(body: unknown): Record<string, unknown> {
  const data = (body ?? {}) as Record<string, unknown>;
  const row = (data.anomaly ?? {}) as Record<string, unknown>;
  const occurrences = Array.isArray(data.occurrences) ? data.occurrences : [];
  const conversation = (data.conversation ?? {}) as Record<string, unknown>;
  const artifacts = Array.isArray(data.verification_artifacts)
    ? data.verification_artifacts
    : [];
  const firstArtifact = (artifacts[0] ?? {}) as Record<string, unknown>;
  return {
    ...mapAnomaly(row),
    occurrences: occurrences.map((occ) => {
      const item = (occ ?? {}) as Record<string, unknown>;
      return {
        occurrenceId: String(item.occurrence_id ?? ''),
        commandId: (item.command_id as string | null) ?? null,
        errorCode: (item.error_code as string | null) ?? null,
        occurredAt: String(item.occurred_at ?? ''),
        message: String(
          ((item.error ?? {}) as Record<string, unknown>).message ??
            item.message ??
            ''
        )
      };
    }),
    conversationId:
      (conversation.conversation_id as string | null) ?? null,
    verificationArtifactId:
      (firstArtifact.artifact_id as string | null) ?? null,
    traceId: String(row.trace_id ?? ''),
    snapshot: firstArtifact.snapshot
      ? {
          capturedAt: String(firstArtifact.created_at ?? ''),
          schemaVersion: Number(firstArtifact.schema_version ?? 1),
          fields: firstArtifact.snapshot as Record<string, unknown>
        }
      : null
  };
}

function mapAnomalyList(body: unknown): AnomalyListResponse {
  const data = (body ?? {}) as { anomalies?: unknown; next_cursor?: unknown };
  const rows = Array.isArray(data.anomalies) ? data.anomalies : [];
  return {
    items: rows
      .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
      .map(mapAnomaly),
    nextCursor: (data.next_cursor as string | null | undefined) ?? null
  };
}

function mapStreamEvent(raw: Record<string, unknown>): AnomalyStreamEvent | null {
  const eventType = String(raw.event_type ?? '');
  const payload = (raw.payload as Record<string, unknown> | undefined) ?? {};
  const seq = Number(raw.event_seq ?? 0);
  // The workbench emits three anomaly event families. The renderer's
  // Zod discriminated union only models ``anomaly.opened`` and
  // ``anomaly.resolved``; ``anomaly.merged`` collapses into ``opened``
  // and ``anomaly.ignored`` collapses into ``resolved`` because the
  // store does not need to distinguish them in the inbox UI.
  if (eventType === 'anomaly.resolved' || eventType === 'anomaly.ignored') {
    return {
      type: 'anomaly.resolved',
      seq,
      anomalyId: String(payload.anomaly_id ?? raw.aggregate_id ?? '')
    };
  }
  if (
    eventType === 'anomaly.opened' ||
    eventType === 'anomaly.merged' ||
    eventType === 'anomaly.updated'
  ) {
    // The backend does not echo the full anomaly row in the event
    // payload, only its id + version. The store will refetch when
    // it needs the full row, so we ship a minimal Anomaly stub here.
    const stub: Anomaly = {
      anomalyId: String(payload.anomaly_id ?? raw.aggregate_id ?? ''),
      title: '',
      description: '',
      severity: asAnomalySeverity(payload.severity),
      status: asAnomalyStatus(payload.status),
      sourcePlugin: '',
      sourceCapability: '',
      ownerActorId: null,
      occurrenceCount: 1,
      firstSeenAt: '',
      lastSeenAt: String(raw.created_at ?? ''),
      deepLink: null,
      version: Number(payload.version ?? 1)
    };
    return {
      type: 'anomaly.opened',
      seq,
      anomaly: stub
    };
  }
  return null;
}

function mapTrigger(row: Record<string, unknown>): Trigger {
  const typeValue = String(row.trigger_type ?? 'cron');
  const type: Trigger['type'] =
    typeValue === 'event' || typeValue === 'condition' || typeValue === 'cron'
      ? typeValue
      : 'cron';
  const statusValue = String(row.status ?? 'draft');
  const status: Trigger['status'] =
    statusValue === 'enabled' ||
    statusValue === 'paused' ||
    statusValue === 'error' ||
    statusValue === 'archived'
      ? statusValue
      : 'draft';
  return {
    triggerId: String(row.trigger_id ?? ''),
    pluginId: String(row.plugin_id ?? ''),
    capabilityId: String(row.capability_id ?? ''),
    type,
    status,
    version: Number(row.version ?? 1),
    config: (row.config as Record<string, unknown>) ?? {},
    arguments: (row.arguments as Record<string, unknown>) ?? {},
    condition: (row.condition as Record<string, unknown> | null) ?? null,
    nextFireAt: (row.next_fire_at as string | null) ?? null,
    lastFiredAt: (row.last_fired_at as string | null) ?? null,
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? '')
  };
}

function mapTriggerList(body: unknown): TriggerListResponse {
  const data = (body ?? {}) as { triggers?: unknown; next_cursor?: unknown };
  const rows = Array.isArray(data.triggers) ? data.triggers : [];
  return {
    items: rows
      .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
      .map(mapTrigger),
    nextCursor: (data.next_cursor as string | null | undefined) ?? null
  };
}

export function buildDevBridge(): WorkbenchApi {
  let browserState: BrowserState = {
    available: true,
    mode: 'preview',
    visible: false,
    url: '',
    title: '浏览器预览',
    isLoading: false,
    canGoBack: false,
  canGoForward: false,
  lastError: null,
  artifactId: null,
  artifactDisplayName: null
  };
  const browserListeners = new Set<(state: BrowserState) => void>();
  const updateBrowserState = (patch: Partial<BrowserState>): BrowserState => {
    browserState = { ...browserState, ...patch };
    for (const listener of browserListeners) listener(browserState);
    return browserState;
  };
  const navigateBrowser = async (url: string): Promise<BrowserActionResult> => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('仅允许访问 HTTP 或 HTTPS 网页');
      }
      updateBrowserState({
        visible: true,
        url: parsed.href,
        title: parsed.hostname,
        isLoading: true,
        lastError: null
      });
      await Promise.resolve();
      return {
        ok: true,
        message: `已在浏览器预览中打开 ${parsed.hostname}`,
        state: updateBrowserState({ isLoading: false })
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        message,
        state: updateBrowserState({ isLoading: false, lastError: message })
      };
    }
  };

  return {
    async request(input: RequestInput): Promise<RequestResponse> {
      const session = loadSession();
      const base = session.baseUrl.replace(/\/$/, '');
      const url = `${base}${input.path}`;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...sessionHeaders(session)
      };
      if (session.hasApiKey) {
        headers['X-API-Key'] = loadDevApiKey();
      }
      if (input.idempotencyKey) headers['Idempotency-Key'] = input.idempotencyKey;
      if (input.expectedVersion !== undefined) {
        headers['If-Match'] = String(input.expectedVersion);
      }
      const method = (input.method || 'GET').toUpperCase();
      const init: RequestInit = {
        method,
        headers
      };
      if (input.body !== undefined && method !== 'GET' && method !== 'HEAD') {
        init.body = typeof input.body === 'string' ? input.body : JSON.stringify(input.body);
      }
      try {
        const res = await fetch(url, init);
        const text = await res.text();
        let body: unknown = text;
        if (text) {
          try {
            body = JSON.parse(text);
          } catch {
            body = text;
          }
        }
        // Translate snake_case wire shape to the typed camelCase the
        // renderer expects. The main process performs the same
        // translation in production so the contract stays stable.
        const pathOnly = input.path.split('?')[0];
        if (res.status < 400) {
          if (pathOnly === '/api/anomalies' && method === 'GET') {
            body = mapAnomalyList(body);
          } else if (
            /^\/api\/anomalies\/[A-Za-z0-9_-]+$/.test(pathOnly) &&
            method === 'GET'
          ) {
            body = mapAnomalyDetail(body);
          } else if (
            pathOnly.startsWith('/api/triggers') &&
            method === 'GET' &&
            !pathOnly.includes('/firings')
          ) {
            body = mapTriggerList(body);
          } else if (pathOnly === '/api/telesales/workspace' && method === 'GET') {
            body = mapWorkbenchResponse(input.path, method, body, res.status);
          } else {
            body = mapWorkbenchResponse(input.path, method, body, res.status);
          }
        } else {
          // Normalise FastAPI's ``{detail: ...}`` error shape into the
          // ``{error: {code, message}}`` envelope the UI expects.
          if (body && typeof body === 'object' && 'detail' in (body as Record<string, unknown>)) {
            const detail = (body as Record<string, unknown>).detail;
            body = {
              error: {
                code: `HTTP_${res.status}`,
                message: typeof detail === 'string' ? detail : JSON.stringify(detail)
              }
            };
          }
        }
        return { status: res.status, body };
      } catch (err) {
        return {
          status: 0,
          body: {
            error: {
              code: 'NETWORK_ERROR',
              message: err instanceof Error ? err.message : String(err)
            }
          }
        };
      }
    },

    async readArtifactContent(artifactId: string) {
      const session = loadSession();
      const response = await fetch(
        `${session.baseUrl.replace(/\/$/, '')}/api/artifacts/${encodeURIComponent(
          artifactId
        )}/content`,
        {
          headers: {
            ...sessionHeaders(session),
            ...(session.hasApiKey ? { 'X-API-Key': loadDevApiKey() } : {})
          }
        }
      );
      if (!response.ok) {
        return { ok: false as const, error: `读取失败（HTTP ${response.status}）` };
      }
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > 25 * 1024 * 1024) {
        return { ok: false as const, error: '文件超过 25MB 内嵌预览限制' };
      }
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      }
      return {
        ok: true as const,
        dataBase64: btoa(binary),
        sizeBytes: bytes.length
      };
    },

    async selectAndUploadKnowledgeDocument(_knowledgeBaseId: string) {
      return {
        ok: false as const,
        error: '浏览器开发模式不能打开本地文件选择器；请使用桌面客户端导入文件。'
      };
    },

    async streamAssistant(
      input: AssistantStreamInput,
      listener: (event: AssistantStreamEvent) => void
    ): Promise<() => void> {
      const session = loadSession();
      const path = `/api/conversations/${encodeURIComponent(
        input.conversationId
      )}/assistant/stream`;
      const url = `${session.baseUrl.replace(/\/$/, '')}${path}`;
      const controller = new AbortController();
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        controller.abort();
      };
      void (async () => {
        try {
          const headers: Record<string, string> = {
            Accept: 'text/event-stream',
            'Content-Type': 'application/json',
            'Idempotency-Key': input.clientMessageId,
            ...sessionHeaders(session)
          };
          if (session.hasApiKey) headers['X-API-Key'] = loadDevApiKey();
          const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              message: input.message,
              client_message_id: input.clientMessageId,
              attachment_ids: input.attachmentIds,
              ...(input.knowledgeBaseIds !== undefined
                ? { knowledge_base_ids: input.knowledgeBaseIds }
                : {})
            }),
            signal: controller.signal
          });
          if (!response.ok || !response.body) {
            throw new Error(
              (await response.text().catch(() => '')) ||
                `stream handshake failed: ${response.status}`
            );
          }
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          while (!closed) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let match = /\r?\n\r?\n/.exec(buffer);
            while (match) {
              const frame = buffer.slice(0, match.index);
              buffer = buffer.slice(match.index + match[0].length);
              const data = frame
                .split(/\r?\n/)
                .filter((line) => line.startsWith('data:'))
                .map((line) => line.slice(5).trimStart())
                .join('\n');
              if (data) {
                const raw = JSON.parse(data) as unknown;
                const mapped = mapWorkbenchResponse(
                  path,
                  'POST',
                  raw,
                  response.status
                );
                const parsed = AssistantStreamEventSchema.safeParse(mapped);
                if (parsed.success) listener(parsed.data);
              }
              match = /\r?\n\r?\n/.exec(buffer);
            }
          }
        } catch (error) {
          if (closed) return;
          listener({
            type: 'error',
            error: {
              code: 'STREAM_ERROR',
              message: error instanceof Error ? error.message : String(error)
            }
          });
        }
      })();
      return close;
    },

    async subscribeAnomalies(listener: (event: AnomalyStreamEvent) => void): Promise<() => void> {
      const session = loadSession();
      const base = session.baseUrl.replace(/\/$/, '');
      const url = `${base}/api/anomalies/stream?last_event_id=0`;
      const controller = new AbortController();
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        controller.abort();
      };
      // EventSource does not allow custom request headers, which our
      // workbench API needs for tenant/actor scoping. The dev bridge
      // implements the same shape by hand with fetch + ReadableStream
      // and posts typed events to ``listener``. In the packaged
      // Electron build the main process owns the real EventSource and
      // forwards frames over IPC.
      (async () => {
        try {
          const streamHeaders = sessionHeaders(session);
          if (session.hasApiKey) {
            streamHeaders['X-API-Key'] = loadDevApiKey();
          }
          const res = await fetch(url, {
            method: 'GET',
            headers: streamHeaders,
            signal: controller.signal
          });
          if (!res.ok || !res.body) {
            console.warn(
              '[dev-bridge] SSE failed:',
              res.status,
              await res.text().catch(() => '')
            );
            return;
          }
          const reader = res.body.getReader();
          const decoder = new TextDecoder('utf-8');
          let buffer = '';
          while (!closed) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let frameEnd: number;
            while ((frameEnd = buffer.indexOf('\n\n')) !== -1) {
              const frame = buffer.slice(0, frameEnd);
              buffer = buffer.slice(frameEnd + 2);
              const lines = frame.split('\n');
              let event = 'message';
              let data = '';
              for (const line of lines) {
                if (line.startsWith('event:')) event = line.slice(6).trim();
                else if (line.startsWith('data:')) data += line.slice(5).trim();
              }
              if (!data || event === 'heartbeat') continue;
              try {
                const raw = JSON.parse(data) as Record<string, unknown>;
                const event = mapStreamEvent(raw);
                if (event) listener(event);
              } catch {
                // ignore malformed frames
              }
            }
          }
        } catch (err) {
          if (!closed) {
            console.warn('[dev-bridge] SSE error', err);
          }
        }
      })();
      return close;
    },

    async openVerificationArtifact(artifactId: string): Promise<VerificationOpenResult | null> {
      return {
        url: `https://oa.example.com/leave/ART-${artifactId}`,
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
        traceId: `TRACE-DEV-${artifactId}`
      };
    },

    async getSession(): Promise<SessionState> {
      return loadSession();
    },

    async updateSession(input: SessionUpdate): Promise<{ ok: boolean; session?: SessionState; error?: { code: string; message: string } }> {
      const current = loadSession();
      const next: SessionState = {
        tenantId: input.tenantId ?? current.tenantId,
        actorId: input.actorId ?? current.actorId,
        baseUrl: input.baseUrl ?? current.baseUrl,
        hasApiKey: input.apiKey !== undefined ? Boolean(input.apiKey) : current.hasApiKey
      };
      const candidateApiKey = input.apiKey ?? loadDevApiKey();
      try {
        const response = await fetch(
          `${next.baseUrl.replace(/\/$/, '')}/api/context`,
          {
            method: 'GET',
            headers: {
              ...sessionHeaders(next),
              'X-API-Key': candidateApiKey
            }
          }
        );
        if (!response.ok) {
          const body = await response.json().catch(() => null) as {
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
      } catch (reason) {
        return {
          ok: false,
          error: {
            code: 'CONNECTION_FAILED',
            message: `连接验证失败：${reason instanceof Error ? reason.message : String(reason)}`
          }
        };
      }
      if (input.apiKey !== undefined) {
        saveDevApiKey(input.apiKey);
      }
      saveSession(next);
      return { ok: true, session: next };
    },

    async browserGetState(): Promise<BrowserState> {
      return browserState;
    },

    async browserSetVisible(visible: boolean): Promise<BrowserState> {
      return updateBrowserState({ visible });
    },

    async browserSetBounds(_bounds: BrowserBounds): Promise<BrowserState> {
      return browserState;
    },

    async browserNavigate(url: string): Promise<BrowserActionResult> {
      return navigateBrowser(url);
    },

    async browserOpenArtifact(input: BrowserArtifactInput): Promise<BrowserActionResult> {
      const session = loadSession();
      const url = `${session.baseUrl.replace(/\/$/, '')}/api/artifacts/${encodeURIComponent(
        input.artifactId
      )}/preview`;
      const state = updateBrowserState({
        visible: true,
        url,
        title: input.displayName,
        artifactId: input.artifactId,
        artifactDisplayName: input.displayName,
        lastError: null
      });
      return { ok: true, message: `已打开 ${input.displayName}`, state };
    },

    async exportArtifactToPptx(_input: BrowserArtifactInput) {
      return { ok: false, error: 'HTML 转 PPTX 仅在 Electron 客户端中可用' };
    },

    async openExternalUrl(_url: string) {
      return { ok: false, error: '在系统浏览器打开仅在 Electron 客户端中可用' };
    },

    async requestArtifactPreviewToken(_input: {
      artifactId: string;
    }) {
      return { ok: false, error: '预览 token 仅在 Electron 客户端中可用' };
    },

    async browserAction(action: BrowserAction): Promise<BrowserActionResult> {
      if (action.type === 'navigate') return navigateBrowser(action.url);
      if (action.type === 'extract') {
        return {
          ok: true,
          message: '已读取当前页面内容',
          state: browserState,
          extractedText:
            `浏览器预览页面：${browserState.title}\n地址：${browserState.url}\n` +
            '这是开发预览模式。桌面应用会读取实际网页正文并交给助手总结。'
        };
      }
      const messages: Record<Exclude<BrowserAction['type'], 'navigate' | 'extract'>, string> = {
        back: '已返回上一页',
        forward: '已前往下一页',
        reload: '已刷新页面',
        stop: '已停止加载',
        click: `已点击“${action.type === 'click' ? action.targetText : ''}”`,
        type: '已输入内容',
        scroll:
          action.type === 'scroll' && action.direction === 'up'
            ? '已向上滚动'
            : '已向下滚动'
      };
      return {
        ok: true,
        message: messages[action.type],
        state: browserState
      };
    },

    async subscribeBrowserState(
      listener: (state: BrowserState) => void
    ): Promise<() => void> {
      browserListeners.add(listener);
      listener(browserState);
      return () => browserListeners.delete(listener);
    }
  };
}
