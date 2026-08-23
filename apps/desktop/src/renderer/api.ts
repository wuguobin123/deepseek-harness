/**
 * Renderer-side API wrapper.
 *
 * Calls go through `window.workbenchApi` (preload bridge). In tests and
 * Storybook we use a stub bridge assigned to `window.__WORKBENCH_API_OVERRIDE__`
 * by the test harness before `main.tsx` mounts.
 */
import type {
  AssistantResponse,
  AssistantStreamEvent,
  AssistantStreamInput,
  AppUpdateState,
  ArtifactPickerResult,
  KnowledgeDocumentPickerResult,
  ConversationArtifact,
  ConversationMessage,
  ConversationSummary,
  PersistentAssistantTurn,
  Anomaly,
  AnomalyDetail,
  AnomalyListResponse,
  AnomalyStreamEvent,
  CommandPreviewResponse,
  CommandResponse,
  KnowledgeBase,
  KnowledgeDocument,
  KnowledgeSearchResult,
  RequestInput,
  RequestResponse,
  SessionState,
  SessionUpdate,
  SkillBundleInspection,
  SkillInstallProposal,
  AccountAuthentication,
  EmailCodeRequest,
  EmailCodeResponse,
  Trigger,
  TriggerFiring,
  TriggerListResponse,
  TriggerUpsert,
  VerificationOpenResult
} from '../shared/contracts';
import {
  AssistantResponseSchema,
  ConversationArtifactListSchema,
  ConversationListSchema,
  ConversationMessagePageSchema,
  ConversationSummarySchema,
  PersistentAssistantTurnSchema,
  CommandPreviewResponseSchema,
  CommandResponseSchema,
  KnowledgeBaseSchema,
  KnowledgeDocumentSchema,
  KnowledgeSearchResultSchema
} from '../shared/contracts';

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
  authenticateSession: (
    input: AccountAuthentication
  ) => Promise<{ ok: boolean; session?: SessionState; error?: { code: string; message: string } }>;
  sendEmailVerificationCode: (
    input: EmailCodeRequest
  ) => Promise<
    | EmailCodeResponse
    | { ok: false; error: { code: string; message: string; retry_after_seconds?: number } }
  >;
  logoutSession: () => Promise<{ ok: boolean }>;
  selectAndUploadArtifact: (conversationId: string) => Promise<ArtifactPickerResult>;
  selectAndUploadKnowledgeDocument: (knowledgeBaseId: string) => Promise<KnowledgeDocumentPickerResult>;
  uploadClipboardImage: (input: {
    conversationId: string;
    filename: string;
    mimeType: string;
    contentBase64: string;
  }) => Promise<ArtifactPickerResult>;
  openArtifactFile: (
    artifactId: string,
    mode?: 'open' | 'download' | 'show-in-folder'
  ) => Promise<{ ok: boolean; path?: string; error?: string }>;
  downloadArtifactFile: (artifactId: string) => Promise<{
    ok: boolean;
    path?: string;
    error?: string;
  }>;
  convertArtifactToPdf: (artifactId: string) => Promise<
    | {
        ok: true;
        pdfPath: string;
        sourcePath: string;
        tool: string;
        sizeBytes: number;
      }
    | { ok: false; error: string; support: 'native' | 'convertible' | 'unsupported' }
  >;
  readLocalPdf: (pdfPath: string) => Promise<
    { ok: true; dataBase64: string; sizeBytes: number } | { ok: false; error: string }
  >;
  readArtifactContent: (artifactId: string) => Promise<
    { ok: true; dataBase64: string; sizeBytes: number } | { ok: false; error: string }
  >;
  getAppUpdateState: () => Promise<AppUpdateState>;
  checkAppUpdate: () => Promise<AppUpdateState>;
  openAppUpdateDownload: () => Promise<{ ok: boolean; error?: string }>;
  subscribeAppUpdateState: (
    listener: (state: AppUpdateState) => void
  ) => Promise<() => void>;
  openExternalUrl: (url: string) => Promise<{ ok: boolean; error?: string }>;
  requestArtifactPreviewToken: (input: {
    artifactId: string;
  }) => Promise<{ ok: true; token: string; expiresAt: number } | { ok: false; error: string }>;
};

function getBridge(): WorkbenchApi {
  if (!window.workbenchApi) {
    throw new Error('workbenchApi bridge is not available — preload script did not run');
  }
  return window.workbenchApi as unknown as WorkbenchApi;
}

async function okBody<T>(res: RequestResponse): Promise<T> {
  if (res.status < 200 || res.status >= 400) {
    const err = (res.body as { error?: { code?: string; message?: string } } | undefined)?.error;
    const message = err?.message ?? (res.status === 0 ? '无法连接后端服务' : `HTTP ${res.status}`);
    throw new ApiError(message, res.status, err?.code);
  }
  return res.body as T;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  /** goal_contract 失败时服务端随 error 事件携带的阶段性结果原文。 */
  readonly partialAnswer: string | undefined;
  constructor(message: string, status: number, code?: string, partialAnswer?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.partialAnswer = partialAnswer;
  }
}

export type PromptSkillSummary = {
  name: string;
  description: string;
};

export const workbenchApi = {
  /**
   * Low-level typed request. Used by features that need a custom body shape
   * (e.g. conversation turns). Higher-level wrappers (listAnomalies,
   * claimAnomaly, …) compose on top.
   */
  async request(input: RequestInput): Promise<RequestResponse> {
    return getBridge().request(input);
  },

  async authenticateSession(input: AccountAuthentication) {
    return getBridge().authenticateSession(input);
  },

  async sendEmailVerificationCode(input: EmailCodeRequest) {
    return getBridge().sendEmailVerificationCode(input);
  },

  async logoutSession() {
    return getBridge().logoutSession();
  },

  async listPromptSkills(): Promise<PromptSkillSummary[]> {
    const body = await okBody<{ skills?: PromptSkillSummary[] }>(
      await getBridge().request({ method: 'GET', path: '/api/prompt-skills' })
    );
    return body.skills ?? [];
  },

  async decideSkillInstallation(
    proposalId: string,
    conversationId: string,
    decision: 'approve' | 'reject'
  ): Promise<Record<string, unknown>> {
    return okBody<Record<string, unknown>>(
      await getBridge().request({
        method: 'POST',
        path: `/api/skill-installations/${encodeURIComponent(proposalId)}/decision`,
        body: { decision, conversation_id: conversationId },
        idempotencyKey: `skill-install-${proposalId}-${decision}`
      })
    );
  },

  async installSkillsFromArtifact(input: {
    artifactId: string;
    conversationId: string;
    selectedSlugs?: string[];
  }): Promise<{
    bundle?: SkillBundleInspection;
    proposals: SkillInstallProposal[];
    installations?: Array<Record<string, unknown>>;
  }> {
    return okBody<{
      bundle?: SkillBundleInspection;
      proposals: SkillInstallProposal[];
      installations?: Array<Record<string, unknown>>;
    }>(
      await getBridge().request({
        method: 'POST',
        path: '/api/skill-installations/from-artifact',
        body: {
          artifact_id: input.artifactId,
          conversation_id: input.conversationId,
          ...(input.selectedSlugs
            ? { selected_slugs: input.selectedSlugs }
            : {})
        },
        idempotencyKey: `skill-install-from-artifact-${input.artifactId}-${Date.now()}`
      })
    );
  },

  async getConversationSkillInstallState(
    conversationId: string
  ): Promise<{ bundles: SkillBundleInspection[]; proposals: SkillInstallProposal[] }> {
    return okBody<{ bundles: SkillBundleInspection[]; proposals: SkillInstallProposal[] }>(
      await getBridge().request({
        method: 'GET',
        path: `/api/conversations/${encodeURIComponent(conversationId)}/skill-install-state`
      })
    );
  },

  async requestArtifactPreviewToken(input: {
    artifactId: string;
  }): Promise<{ ok: true; token: string; expiresAt: number } | { ok: false; error: string }> {
    try {
      const result = await okBody<{ token: string; expires_at: number }>(
        await getBridge().request({
          method: 'POST',
          path: `/api/artifacts/${encodeURIComponent(input.artifactId)}/preview-token`
        })
      );
      return { ok: true, token: result.token, expiresAt: result.expires_at };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  },

  async decideSkillWorkshop(
    proposalId: string,
    conversationId: string,
    decision: 'approve' | 'reject'
  ): Promise<Record<string, unknown>> {
    return okBody<Record<string, unknown>>(
      await getBridge().request({
        method: 'POST',
        path: `/api/skill-workshop/${encodeURIComponent(proposalId)}/decision`,
        body: { decision, conversation_id: conversationId },
        idempotencyKey: `skill-workshop-${proposalId}-${decision}`
      })
    );
  },

  async askAssistant(input: {
    message: string;
    page: string;
    objectType?: string;
    objectId?: string;
  }): Promise<AssistantResponse> {
    const body = await okBody<unknown>(
      await getBridge().request({
        method: 'POST',
        path: '/api/assistant',
        body: {
          message: input.message,
          page: input.page,
          object_type: input.objectType,
          object_id: input.objectId
        }
      })
    );
    const parsed = AssistantResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(
        '回答已生成，但返回的数据格式暂时无法识别。请重新执行。',
        502,
        'INVALID_ASSISTANT_RESPONSE'
      );
    }
    return parsed.data;
  },

  async createConversation(title = ''): Promise<ConversationSummary> {
    const body = await okBody<unknown>(
      await getBridge().request({
        method: 'POST',
        path: '/api/conversations',
        body: {
          conversation_type: 'assistant',
          title,
          metadata: { channel: 'desktop' }
        },
        idempotencyKey: `conversation-${Date.now()}`
      })
    );
    return ConversationSummarySchema.parse(body);
  },

  async listConversations(): Promise<ConversationSummary[]> {
    const body = await okBody<unknown>(
      await getBridge().request({
        method: 'GET',
        path: '/api/conversations?status=active&limit=50'
      })
    );
    return ConversationListSchema.parse(body).items;
  },

  async listConversationMessages(conversationId: string): Promise<ConversationMessage[]> {
    const body = await okBody<unknown>(
      await getBridge().request({
        method: 'GET',
        path: `/api/conversations/${encodeURIComponent(conversationId)}/messages?limit=200`
      })
    );
    return ConversationMessagePageSchema.parse(body).messages;
  },

  async listConversationArtifacts(conversationId: string): Promise<ConversationArtifact[]> {
    const body = await okBody<unknown>(
      await getBridge().request({
        method: 'GET',
        path: `/api/conversations/${encodeURIComponent(conversationId)}/artifacts`
      })
    );
    return ConversationArtifactListSchema.parse(body).artifacts;
  },

  async askConversation(input: {
    conversationId: string;
    message: string;
    clientMessageId: string;
    attachmentIds?: string[];
  }): Promise<PersistentAssistantTurn> {
    const body = await okBody<unknown>(
      await getBridge().request({
        method: 'POST',
        path: `/api/conversations/${encodeURIComponent(input.conversationId)}/assistant`,
        body: {
          message: input.message,
          client_message_id: input.clientMessageId,
          attachment_ids: input.attachmentIds ?? []
        },
        idempotencyKey: input.clientMessageId
      })
    );
    return PersistentAssistantTurnSchema.parse(body);
  },

  async askConversationStream(
    input: AssistantStreamInput,
    onEvent: (event: AssistantStreamEvent) => void,
    signal?: AbortSignal
  ): Promise<PersistentAssistantTurn> {
    return new Promise((resolve, reject) => {
      let stop: (() => void) | undefined;
      let settled = false;
      const abort = () => {
        if (settled) return;
        settled = true;
        stop?.();
        reject(new DOMException('assistant generation stopped', 'AbortError'));
      };
      const finish = () => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', abort);
        stop?.();
      };
      if (signal?.aborted) {
        abort();
        return;
      }
      signal?.addEventListener('abort', abort, { once: true });
      void getBridge()
        .streamAssistant(input, (event) => {
          if (settled) return;
          onEvent(event);
          if (event.type === 'completed') {
            finish();
            resolve(event.turn);
          } else if (event.type === 'error') {
            finish();
            reject(
              new ApiError(
                event.error.message,
                500,
                event.error.code,
                event.error.answer
              )
            );
          }
        })
        .then((unsubscribe) => {
          stop = unsubscribe;
          if (settled) unsubscribe();
        })
        .catch((error: unknown) => {
          if (settled) return;
          finish();
          reject(error);
        });
    });
  },

  async selectAndUploadArtifact(conversationId: string): Promise<ArtifactPickerResult> {
    return getBridge().selectAndUploadArtifact(conversationId);
  },

  async selectAndUploadKnowledgeDocument(
    knowledgeBaseId: string
  ): Promise<KnowledgeDocumentPickerResult> {
    return getBridge().selectAndUploadKnowledgeDocument(knowledgeBaseId);
  },

  async uploadClipboardImage(input: {
    conversationId: string;
    filename: string;
    mimeType: string;
    contentBase64: string;
  }): Promise<ArtifactPickerResult> {
    return getBridge().uploadClipboardImage(input);
  },

  async recordExternalResult(input: {
    conversationId: string;
    clientMessageId: string;
    runId?: string;
    actionId?: string;
    parentRunId?: string;
    baseRevision?: string | number;
    expiresAt?: string | number;
    userMessage: string;
    assistantMessage?: string;
    sourceContent?: string;
    sourceType: 'web' | 'tool';
    sourceTitle: string;
    sourceUri?: string;
  }): Promise<PersistentAssistantTurn> {
    const body = await okBody<unknown>(
      await getBridge().request({
        method: 'POST',
        path: `/api/conversations/${encodeURIComponent(
          input.conversationId
        )}/external-result`,
        body: {
          client_message_id: input.clientMessageId,
          ...(input.runId !== undefined ? { run_id: input.runId } : {}),
          ...(input.actionId !== undefined ? { action_id: input.actionId } : {}),
          ...(input.parentRunId !== undefined ? { parent_run_id: input.parentRunId } : {}),
          ...(input.baseRevision !== undefined ? { base_revision: input.baseRevision } : {}),
          ...(input.expiresAt !== undefined ? { expires_at: input.expiresAt } : {}),
          user_message: input.userMessage,
          assistant_message: input.assistantMessage,
          source_content: input.sourceContent,
          source_type: input.sourceType,
          source_title: input.sourceTitle,
          source_uri: input.sourceUri
        },
        idempotencyKey: input.clientMessageId,
        timeoutMs: input.sourceContent ? 180_000 : undefined
      })
    );
    const turn = PersistentAssistantTurnSchema.parse(body);
    // Older servers do not echo the binding yet; the request itself is still
    // bound to this action, while any explicit server binding remains authoritative.
    return {
      ...turn,
      runId: turn.runId || input.runId || '',
      actionId: turn.actionId ?? input.actionId
    };
  },

  async previewCommand(input: {
    message: string;
    page: string;
    objectType?: string;
    objectId?: string;
  }): Promise<CommandPreviewResponse> {
    const body = await okBody<unknown>(
      await getBridge().request({
        method: 'POST',
        path: '/api/commands/preview',
        body: {
          message: input.message,
          page: input.page,
          object_type: input.objectType,
          object_id: input.objectId,
          auto_execute: true
        }
      })
    );
    return CommandPreviewResponseSchema.parse(body);
  },

  async confirmCommand(commandId: string, expectedVersion: number): Promise<CommandResponse> {
    const body = await okBody<unknown>(
      await getBridge().request({
        method: 'POST',
        path: `/api/commands/${encodeURIComponent(commandId)}/confirm`,
        body: { expected_version: expectedVersion },
        idempotencyKey: `confirm-command-${commandId}`,
        expectedVersion
      })
    );
    return CommandResponseSchema.parse(body);
  },

  async cancelCommand(
    commandId: string,
    expectedVersion: number,
    reason = '用户在 AI 工作台取消'
  ): Promise<CommandResponse> {
    const body = await okBody<unknown>(
      await getBridge().request({
        method: 'POST',
        path: `/api/commands/${encodeURIComponent(commandId)}/cancel`,
        body: { expected_version: expectedVersion, reason },
        idempotencyKey: `cancel-command-${commandId}`,
        expectedVersion
      })
    );
    return CommandResponseSchema.parse(body);
  },

  async executeCommandAction(
    commandId: string,
    actionId: string,
    expectedVersion: number
  ): Promise<CommandResponse> {
    const body = await okBody<unknown>(
      await getBridge().request({
        method: 'POST',
        path: `/api/commands/${encodeURIComponent(commandId)}/actions/${encodeURIComponent(actionId)}/execute`,
        body: { expected_version: expectedVersion },
        idempotencyKey: `command-action-${commandId}-${actionId}`,
        expectedVersion
      })
    );
    return CommandResponseSchema.parse(body);
  },

  async listKnowledgeBases(): Promise<KnowledgeBase[]> {
    const body = await okBody<{ knowledgeBases?: unknown[] }>(
      await getBridge().request({ method: 'GET', path: '/api/knowledge/bases' })
    );
    return (body.knowledgeBases ?? []).map((item) => KnowledgeBaseSchema.parse(item));
  },

  async createKnowledgeBase(input: {
    name: string;
    description?: string;
    domain?: string;
    routingKeywords?: string[];
  }): Promise<KnowledgeBase> {
    const body = await okBody<unknown>(
      await getBridge().request({
        method: 'POST',
        path: '/api/knowledge/bases',
        body: {
          name: input.name,
          description: input.description ?? '',
          domain: input.domain ?? '',
          routing_keywords: input.routingKeywords ?? []
        },
        idempotencyKey: `knowledge-base-${Date.now()}`
      })
    );
    return KnowledgeBaseSchema.parse(body);
  },

  async listKnowledgeDocuments(knowledgeBaseId?: string): Promise<KnowledgeDocument[]> {
    const query = knowledgeBaseId
      ? `?${new URLSearchParams({ knowledge_base_id: knowledgeBaseId }).toString()}`
      : '';
    const body = await okBody<{ documents?: unknown[] }>(
      await getBridge().request({ method: 'GET', path: `/api/knowledge/documents${query}` })
    );
    return (body.documents ?? []).map((item) => KnowledgeDocumentSchema.parse(item));
  },

  async searchKnowledge(
    query: string,
    options?: { knowledgeBaseId?: string; autoRoute?: boolean }
  ): Promise<KnowledgeSearchResult> {
    const qs = new URLSearchParams({
      q: query,
      limit: '20',
      auto_route: options?.autoRoute === false ? 'false' : 'true'
    });
    if (options?.knowledgeBaseId) {
      qs.set('knowledge_base_id', options.knowledgeBaseId);
      qs.set('auto_route', 'false');
    }
    const body = await okBody<unknown>(
      await getBridge().request({
        method: 'GET',
        path: `/api/knowledge/search?${qs.toString()}`
      })
    );
    return KnowledgeSearchResultSchema.parse(body);
  },

  async createKnowledgeDocument(input: {
    title: string;
    text: string;
    uri?: string;
    knowledgeBaseId?: string;
  }): Promise<KnowledgeDocument> {
    const body = await okBody<unknown>(
      await getBridge().request({
        method: 'POST',
        path: '/api/knowledge/documents',
        body: {
          title: input.title,
          text: input.text,
          uri: input.uri,
          knowledge_base_id: input.knowledgeBaseId
        },
        idempotencyKey: `knowledge-${Date.now()}`
      })
    );
    return KnowledgeDocumentSchema.parse(body);
  },

  async listAnomalies(params: {
    status?: string;
    severity?: string;
    owner?: string;
    cursor?: string;
  } = {}): Promise<AnomalyListResponse> {
    const qs = new URLSearchParams();
    if (params.status) qs.set('status', params.status);
    if (params.severity) qs.set('severity', params.severity);
    if (params.owner) qs.set('owner', params.owner);
    if (params.cursor) qs.set('cursor', params.cursor);
    const q = qs.toString();
    return okBody<AnomalyListResponse>(
      await getBridge().request({ method: 'GET', path: `/api/anomalies${q ? `?${q}` : ''}` })
    );
  },

  async getAnomaly(id: string): Promise<AnomalyDetail> {
    return okBody<AnomalyDetail>(
      await getBridge().request({ method: 'GET', path: `/api/anomalies/${encodeURIComponent(id)}` })
    );
  },

  async claimAnomaly(id: string): Promise<Anomaly> {
    return okBody<Anomaly>(
      await getBridge().request({
        method: 'POST',
        path: `/api/anomalies/${encodeURIComponent(id)}/claim`,
        idempotencyKey: `claim-${id}-${Date.now()}`
      })
    );
  },

  async resolveAnomaly(id: string, expectedVersion: number, reason: string): Promise<Anomaly> {
    return okBody<Anomaly>(
      await getBridge().request({
        method: 'POST',
        path: `/api/anomalies/${encodeURIComponent(id)}/resolve`,
        body: { reason },
        expectedVersion
      })
    );
  },

  async ignoreAnomaly(id: string, expectedVersion: number, reason: string): Promise<Anomaly> {
    return okBody<Anomaly>(
      await getBridge().request({
        method: 'POST',
        path: `/api/anomalies/${encodeURIComponent(id)}/ignore`,
        body: { reason },
        expectedVersion
      })
    );
  },

  async listTriggers(params: { status?: string; type?: string; cursor?: string } = {}): Promise<TriggerListResponse> {
    const qs = new URLSearchParams();
    if (params.status) qs.set('status', params.status);
    if (params.type) qs.set('type', params.type);
    if (params.cursor) qs.set('cursor', params.cursor);
    const q = qs.toString();
    return okBody<TriggerListResponse>(
      await getBridge().request({ method: 'GET', path: `/api/triggers${q ? `?${q}` : ''}` })
    );
  },

  async listTriggerFirings(limit = 20): Promise<TriggerFiring[]> {
    const body = await okBody<{ firings: TriggerFiring[] }>(
      await getBridge().request({
        method: 'GET',
        path: `/api/triggers/firings/recent?limit=${limit}`
      })
    );
    return body.firings;
  },

  async createTrigger(input: TriggerUpsert): Promise<Trigger> {
    return okBody<Trigger>(
      await getBridge().request({
        method: 'POST',
        path: '/api/triggers',
        body: input,
        idempotencyKey: `create-${Date.now()}`
      })
    );
  },

  async updateTrigger(id: string, expectedVersion: number, patch: Partial<TriggerUpsert>): Promise<Trigger> {
    return okBody<Trigger>(
      await getBridge().request({
        method: 'PUT',
        path: `/api/triggers/${encodeURIComponent(id)}`,
        body: { expected_version: expectedVersion, ...patch },
        expectedVersion
      })
    );
  },

  async enableTrigger(id: string, expectedVersion: number): Promise<Trigger> {
    return okBody<Trigger>(
      await getBridge().request({
        method: 'POST',
        path: `/api/triggers/${encodeURIComponent(id)}/enable`,
        expectedVersion
      })
    );
  },

  async disableTrigger(id: string, expectedVersion: number): Promise<Trigger> {
    return okBody<Trigger>(
      await getBridge().request({
        method: 'POST',
        path: `/api/triggers/${encodeURIComponent(id)}/disable`,
        expectedVersion
      })
    );
  },

  subscribeAnomalies(listener: (event: AnomalyStreamEvent) => void): Promise<() => void> {
    return getBridge().subscribeAnomalies(listener);
  },

  async openVerificationArtifact(artifactId: string): Promise<VerificationOpenResult | null> {
    return getBridge().openVerificationArtifact(artifactId);
  },

  async getSession(): Promise<SessionState> {
    return getBridge().getSession();
  },

  async updateSession(input: SessionUpdate) {
    return getBridge().updateSession(input);
  },

  async getAppUpdateState(): Promise<AppUpdateState> {
    return getBridge().getAppUpdateState();
  },

  async checkAppUpdate(): Promise<AppUpdateState> {
    return getBridge().checkAppUpdate();
  },

  async openAppUpdateDownload(): Promise<{ ok: boolean; error?: string }> {
    return getBridge().openAppUpdateDownload();
  },

  async openExternalUrl(url: string): Promise<{ ok: boolean; error?: string }> {
    return getBridge().openExternalUrl(url);
  },

  subscribeAppUpdateState(
    listener: (state: AppUpdateState) => void
  ): Promise<() => void> {
    return getBridge().subscribeAppUpdateState(listener);
  }
};
