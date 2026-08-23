import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type {
  AssistantResponse,
  AssistantClientAction,
  Command,
  CommandResponse,
  ConversationMessage,
  ConversationSummary,
  SkillBundleInspection,
  SkillInstallProposal,
  SkillWorkshopProposal
} from '../../../shared/contracts';
import { workbenchApi, ApiError } from '../../api';
import type { BrowserOperationPlan } from '../browser/browser-intent';
import { useBrowserWorkspace } from '../browser/BrowserWorkspaceContext';
import {
  artifactPreviewStrategy,
  useDocumentPreview,
  type GeneratedArtifact
} from '../document-preview/DocumentPreviewContext';

export interface AssistantPageContext {
  page: string;
  label: string;
  objectType?: string;
  objectId?: string;
}

interface AssistantRequestSnapshot {
  message: string;
  context: AssistantPageContext;
  attachmentIds?: string[];
  knowledgeBaseIds?: string[];
}

export interface AssistantActivity {
  id: string;
  phase: string;
  message: string;
  turn?: number;
  capabilityId?: string;
}

export type AssistantMessage =
  | {
      id: string;
      role: 'user';
      kind: 'text';
      content: string;
      attachments?: Array<{ artifactId: string; displayName: string }>;
    }
  | {
      id: string;
      role: 'assistant';
      kind: 'answer';
      result: AssistantResponse;
      streaming?: boolean;
      statusText?: string;
      activities?: AssistantActivity[];
      skillInstallProposals?: SkillInstallProposal[];
      skillBundleInspection?: SkillBundleInspection;
      /** @deprecated one-release compatibility for restored in-memory state */
      skillInstallProposal?: SkillInstallProposal;
      skillWorkshopProposal?: SkillWorkshopProposal;
      deepResearch?: DeepResearchTrace;
    }
  | { id: string; role: 'assistant'; kind: 'command'; response: CommandResponse }
  | {
      id: string;
      role: 'assistant';
      kind: 'browser';
      plan: BrowserOperationPlan;
    }
  | {
      id: string;
      role: 'assistant';
      kind: 'error';
      content: string;
      /** goal_contract 失败时服务端携带的阶段性结果原文（失败卡片中渲染）。 */
      partialAnswer?: string;
      request?: AssistantRequestSnapshot;
    };

export interface DeepResearchTrace {
  subQuestions: Array<{ id: string; question: string; intent: string }>;
  coveredIds: string[];
  confidence: number;
  iterations: number;
  reflectionRationale: string;
  missingTopics: string[];
}

export function isBrowserPreviewArtifact(artifact: GeneratedArtifact): boolean {
  return artifactPreviewStrategy(artifact) === 'html';
}

type ClientActionTurn = {
  runId?: string;
  runStatus?: string;
  status?: string;
};

function isWaitingInput(turn: ClientActionTurn): boolean {
  return turn.runStatus === 'waiting_input' || turn.status === 'waiting_input';
}

export function isDispatchableClientAction(
  turn: ClientActionTurn,
  action: Pick<AssistantClientAction, 'actionId' | 'parentRunId' | 'expiresAt' | 'actionStatus'>,
  now = Date.now()
): boolean {
  if (!isWaitingInput(turn) || !action.actionId) return false;
  if (action.parentRunId && turn.runId && action.parentRunId !== turn.runId) return false;
  if (action.actionStatus && !['pending', 'dispatchable'].includes(action.actionStatus)) {
    return false;
  }
  if (action.expiresAt !== undefined) {
    const expiry = typeof action.expiresAt === 'number'
      ? action.expiresAt
      : Date.parse(action.expiresAt);
    if (!Number.isFinite(expiry) || expiry <= now) return false;
  }
  return true;
}

export function claimClientAction(
  dispatched: Set<string>,
  turn: ClientActionTurn,
  action: Pick<AssistantClientAction, 'actionId' | 'parentRunId' | 'expiresAt' | 'actionStatus'>
): boolean {
  if (!isDispatchableClientAction(turn, action)) return false;
  const key = `${turn.runId}:${action.actionId}`;
  if (dispatched.has(key)) return false;
  dispatched.add(key);
  return true;
}

export function shouldApplyExternalResult(
  currentTurn: { runId?: string; actionId?: string },
  externalTurn: { runId?: string; actionId?: string },
  binding: { runId: string; actionId: string }
): boolean {
  return currentTurn.runId === binding.runId &&
    currentTurn.actionId === binding.actionId &&
    externalTurn.runId === binding.runId &&
    externalTurn.actionId === binding.actionId;
}

export function isStaleExternalResultError(error: unknown): boolean {
  const candidate = error as { status?: unknown; code?: unknown } | null;
  const code = String(candidate?.code ?? '').toUpperCase();
  return candidate?.status === 409 || code.includes('NO_OP') || code.includes('STALE') || code.includes('CONFLICT');
}

interface AssistantContextValue {
  open: boolean;
  busy: boolean;
  canStop: boolean;
  context: AssistantPageContext;
  messages: AssistantMessage[];
  conversations: ConversationSummary[];
  activeConversationId: string | null;
  attachments: Array<{ artifactId: string; displayName: string; mimeType?: string | null; previewUrl?: string }>;
  knowledgeBaseIds: string[];
  setKnowledgeBaseIds: (ids: string[]) => void;
  deepMode: boolean;
  setDeepMode: (next: boolean) => void;
  selectConversation: (
    conversationId: string,
    summary?: ConversationSummary
  ) => Promise<void>;
  pickAttachment: () => Promise<void>;
  pasteImage: (input: { mimeType: string; contentBase64: string; previewUrl: string }) => Promise<void>;
  removeAttachment: (artifactId: string) => void;
  openAssistant: (prompt?: string, context?: Partial<AssistantPageContext>) => void;
  closeAssistant: () => void;
  submit: (message: string, context?: Partial<AssistantPageContext>) => Promise<void>;
  stopGeneration: () => void;
  retryMessage: (messageId: string) => Promise<void>;
  confirmCommand: (messageId: string, command: Command) => Promise<void>;
  cancelCommand: (messageId: string, command: Command) => Promise<void>;
  executeCommandAction: (
    messageId: string,
    command: Command,
    actionId: string
  ) => Promise<void>;
  confirmBrowserCommand: (messageId: string) => Promise<void>;
  cancelBrowserCommand: (messageId: string) => Promise<void>;
  openFilesPanel: () => void;
  openArtifactPreview: (artifact: GeneratedArtifact) => void;
  openBrowserPanel: () => Promise<void>;
  saveAsAutomation: (command: Command) => void;
  decideSkillInstallation: (
    messageId: string,
    proposalId: string,
    decision: 'approve' | 'reject'
  ) => Promise<void>;
  decideSkillWorkshop: (
    messageId: string,
    proposalId: string,
    decision: 'approve' | 'reject'
  ) => Promise<void>;
  clear: () => void;
}

const AssistantContext = React.createContext<AssistantContextValue | null>(null);

const ROUTE_CONTEXT: Array<[RegExp, AssistantPageContext]> = [
  [/^\/assistant/, { page: 'assistant', label: 'AI 助手' }],
  [/^\/knowledge/, { page: 'knowledge', label: '知识库' }],
  [/^\/telesales/, { page: 'telesales', label: '电话销售' }],
  [/^\/anomalies\/([^/]+)/, { page: 'anomaly', label: '异常详情', objectType: 'anomaly' }],
  [/^\/anomalies/, { page: 'anomalies', label: '异常队列' }],
  [/^\/tasks/, { page: 'tasks', label: '我的任务' }],
  [/^\/approvals/, { page: 'approvals', label: '待审批' }],
  [/^\/automations|^\/triggers/, { page: 'automations', label: '自动化' }],
  [/^\/history/, { page: 'history', label: '执行历史' }],
  [/^\/integrations/, { page: 'integrations', label: '插件与业务系统' }]
];

function routeContext(pathname: string): AssistantPageContext {
  for (const [pattern, context] of ROUTE_CONTEXT) {
    const match = pathname.match(pattern);
    if (!match) continue;
    if (context.objectType === 'anomaly') {
      return { ...context, objectId: decodeURIComponent(match[1] ?? '') };
    }
    return context;
  }
  return { page: 'home', label: '首页' };
}

function mergeContext(
  current: AssistantPageContext,
  override?: Partial<AssistantPageContext>
): AssistantPageContext {
  return {
    page: override?.page ?? current.page,
    label: override?.label ?? current.label,
    objectType: override?.objectType ?? current.objectType,
    objectId: override?.objectId ?? current.objectId
  };
}

function nextId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function persistedMessage(
  message: ConversationMessage,
  artifactIndex?: Map<string, GeneratedArtifact>
): AssistantMessage | null {
  const text = message.content.blocks
    .filter((block) => block.type === 'text' && block.text)
    .map((block) => block.text)
    .join('\n');
  if (!text || !['user', 'assistant'].includes(message.role)) return null;
  if (message.role === 'user') {
    return { id: message.messageId, role: 'user', kind: 'text', content: text };
  }
  // 保留 artifact_ref 块：用会话 artifact 列表补全元数据，缺失时回退到
  // 块内 extras（后端新消息会带 displayName/mimeType），最终兜底 displayName=artifactId
  const artifacts = message.content.blocks
    .filter((block) => block.type === 'artifact_ref' && block.artifactId)
    .map((block): GeneratedArtifact => {
      const artifactId = String(block.artifactId);
      const known = artifactIndex?.get(artifactId);
      if (known) return known;
      const extras = (block as { extras?: Record<string, unknown> }).extras;
      return {
        artifactId,
        displayName:
          typeof extras?.displayName === 'string' && extras.displayName
            ? extras.displayName
            : artifactId,
        mimeType: typeof extras?.mimeType === 'string' ? extras.mimeType : null,
        artifactType: 'generated_file'
      };
    });
  return {
    id: message.messageId,
    role: 'assistant',
    kind: 'answer',
    result: {
      answer: text,
      sources: [],
      supplementalAnswers: [],
      suggestedActions: [],
      traceId: message.traceId ?? 'persisted',
      ...(artifacts.length > 0 ? { artifacts } : {})
    }
  };
}

export function AssistantProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  const browser = useBrowserWorkspace();
  const docPreview = useDocumentPreview();
  const {
    addArtifact: addPreviewArtifact,
    clearArtifacts: clearPreviewArtifacts,
    setArtifacts: setPreviewArtifacts
  } = docPreview;
  const currentContext = React.useMemo(
    () => routeContext(location.pathname),
    [location.pathname]
  );
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [canStop, setCanStop] = React.useState(false);
  const [messages, setMessages] = React.useState<AssistantMessage[]>([]);
  const [conversations, setConversations] = React.useState<ConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = React.useState<string | null>(null);
  const [attachments, setAttachments] = React.useState<
    Array<{ artifactId: string; displayName: string; mimeType?: string | null; previewUrl?: string }>
  >([]);
  const attachmentsRef = React.useRef(attachments);
  const updateAttachments = React.useCallback(
    (
      updater: (
        items: Array<{ artifactId: string; displayName: string; mimeType?: string | null; previewUrl?: string }>
      ) => Array<{ artifactId: string; displayName: string; mimeType?: string | null; previewUrl?: string }>
    ) => {
      const next = updater(attachmentsRef.current);
      attachmentsRef.current = next;
      setAttachments(next);
    },
    []
  );
  const clearAttachments = React.useCallback(() => {
    attachmentsRef.current = [];
    setAttachments([]);
  }, []);
  const [knowledgeBaseIds, setKnowledgeBaseIds] = React.useState<string[]>([]);
  const [deepMode, setDeepMode] = React.useState<boolean>(false);
  // 用户是否显式拨过开关：未拨过时发送 null（服务端自动判断），
  // 拨过之后发送显式 true/false（显式关闭要赢过启发式自动路由）。
  const [deepModeTouched, setDeepModeTouched] = React.useState<boolean>(false);
  const setDeepModeExplicit = React.useCallback((next: boolean) => {
    setDeepModeTouched(true);
    setDeepMode(next);
  }, []);
  const conversationsRef = React.useRef<ConversationSummary[]>([]);
  const conversationRequestId = React.useRef(0);
  const activeRequestController = React.useRef<AbortController | null>(null);
  const dispatchedClientActions = React.useRef(new Set<string>());

  // 右侧面板互斥编排：Files 面板与 Browser 面板同一时间只开一个
  const openFilesPanel = React.useCallback(() => {
    void browser.close();
    docPreview.openList();
  }, [browser, docPreview]);

  const openArtifactPreview = React.useCallback(
    (artifact: GeneratedArtifact) => {
      if (isBrowserPreviewArtifact(artifact)) {
        docPreview.close();
        void browser.openArtifact(artifact);
        return;
      }
      void browser.close();
      docPreview.open(artifact);
    },
    [browser, docPreview]
  );

  const openBrowserPanel = React.useCallback(async () => {
    docPreview.close();
    await browser.open();
  }, [browser, docPreview]);

  const selectConversation = React.useCallback(async (
    conversationId: string,
    summary?: ConversationSummary
  ) => {
    const requestId = ++conversationRequestId.current;
    setActiveConversationId(conversationId);
    clearAttachments();
    const known =
      summary ??
      conversationsRef.current.find(
        (item) => item.conversationId === conversationId
      );
    setKnowledgeBaseIds(known?.metadata?.knowledgeBaseIds ?? []);
    setBusy(true);
    try {
      const [stored, conversationArtifacts, skillInstallState] = await Promise.all([
        workbenchApi.listConversationMessages(conversationId),
        // artifacts 接口缺失/失败不阻断历史消息恢复
        workbenchApi.listConversationArtifacts(conversationId).catch(() => []),
        workbenchApi.getConversationSkillInstallState(conversationId).catch(() => ({
          bundles: [],
          proposals: []
        }))
      ]);
      if (requestId !== conversationRequestId.current) return;
      const generatedArtifacts = conversationArtifacts.filter(
        (artifact) => artifact.artifactType === 'generated_file'
      );
      // 同步到文件面板（同时清掉上一个会话的残留文件）
      setPreviewArtifacts(generatedArtifacts);
      const artifactIndex = new Map(
        generatedArtifacts.map((artifact) => [artifact.artifactId, artifact])
      );
      const restoredMessages = stored
          .map((message) => persistedMessage(message, artifactIndex))
          .filter((message): message is AssistantMessage => message !== null);
      if (skillInstallState.proposals.length > 0) {
        restoredMessages.push({
          id: `skill-install-state-${conversationId}`,
          role: 'assistant',
          kind: 'answer',
          skillInstallProposals: skillInstallState.proposals,
          skillBundleInspection: skillInstallState.bundles[0],
          result: {
            answer: '以下 Skill 安装提案仍在等待你的确认。',
            sources: [],
            supplementalAnswers: [],
            suggestedActions: [],
            traceId: 'restored-skill-install-state'
          }
        });
      }
      setMessages(restoredMessages);
    } catch (error) {
      if (requestId !== conversationRequestId.current) return;
      setMessages([
        {
          id: nextId('conversation-load-error'),
          role: 'assistant',
          kind: 'error',
          content:
            error instanceof Error
              ? `恢复历史会话失败：${error.message}`
              : '恢复历史会话失败，请稍后重试。'
        }
      ]);
    } finally {
      if (requestId === conversationRequestId.current) {
        setBusy(false);
      }
    }
  }, [clearAttachments, setPreviewArtifacts]);

  React.useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  React.useEffect(() => {
    let cancelled = false;
    void workbenchApi.listConversations().then(async (items) => {
      if (cancelled) return;
      setConversations(items);
      if (items[0]) await selectConversation(items[0].conversationId, items[0]);
    }).catch(() => {
      // Connection diagnostics already surface backend errors globally.
    });
    return () => {
      cancelled = true;
    };
  }, [selectConversation]);

  const ensureConversation = React.useCallback(async (): Promise<string> => {
    if (activeConversationId) return activeConversationId;
    const created = await workbenchApi.createConversation();
    setConversations((items) => [created, ...items]);
    setActiveConversationId(created.conversationId);
    return created.conversationId;
  }, [activeConversationId]);

  const runRequest = React.useCallback(
    async (
      request: AssistantRequestSnapshot,
      replaceMessageId?: string
    ): Promise<void> => {
      setBusy(true);
      setCanStop(true);
      const requestController = new AbortController();
      activeRequestController.current?.abort();
      activeRequestController.current = requestController;
      let pendingAnswerId: string | null = null;
      let pendingDelta = '';
      let deltaFlushTimer: ReturnType<typeof setTimeout> | null = null;
      let activeCandidateId: string | null = null;
      let activeStreamMessageId: string | null = null;
      let skillInstallProposals: SkillInstallProposal[] = [];
      let skillBundleInspection: SkillBundleInspection | undefined;
      let skillWorkshopProposal: SkillWorkshopProposal | undefined;
      const cancelDeltaFlush = (): void => {
        if (deltaFlushTimer !== null) {
          clearTimeout(deltaFlushTimer);
          deltaFlushTimer = null;
        }
      };
      const flushDeltas = (): void => {
        cancelDeltaFlush();
        const delta = pendingDelta;
        pendingDelta = '';
        if (!delta || !activeStreamMessageId) return;
        const messageId = activeStreamMessageId;
        setMessages((items) =>
          items.map((item) =>
            item.id === messageId && item.kind === 'answer'
              ? {
                  ...item,
                  statusText: '正在生成回答…',
                  result: {
                    ...item.result,
                    answer: item.result.answer + delta
                  }
                }
              : item
          )
        );
      };
      const scheduleDeltaFlush = (): void => {
        if (deltaFlushTimer !== null) return;
        // A short render batch avoids one React render per provider token while
        // preserving the native stream's arrival order and realtime feel.
        deltaFlushTimer = setTimeout(flushDeltas, 40);
      };
      const commit = (nextMessage: AssistantMessage): void => {
        setMessages((items) =>
          replaceMessageId
            ? items.map((item) =>
                item.id === replaceMessageId
                  ? { ...nextMessage, id: replaceMessageId }
                  : item
              )
            : [...items, nextMessage]
        );
      };
      const upsert = (nextMessage: AssistantMessage): void => {
        setMessages((items) =>
          items.some((item) => item.id === nextMessage.id)
            ? items.map((item) =>
                item.id === nextMessage.id ? nextMessage : item
              )
            : [...items, nextMessage]
        );
      };
      try {
        // agent 循环是唯一意图路由器（OpenClaw/Claude Code 语义）：消息带着
        // 附件、会话历史等完整上下文直接进入会话 agent，由主模型自行选择工具；
        // URL 也只是用户目标中的一部分，不能被渲染层降级成“打开后结束”。
        // 不再让只见裸文本的本地规则抢占路由并短路返回。
        // 命令编排入口保留在业务页面/审批卡片（服务端 /api/commands/* 不变）。
        const conversationId = await ensureConversation();
        const streamMessageId =
          replaceMessageId ?? nextId('assistant-stream');
        pendingAnswerId = streamMessageId;
        activeStreamMessageId = streamMessageId;
        upsert({
          id: streamMessageId,
          role: 'assistant',
          kind: 'answer',
          streaming: true,
          statusText: '正在连接回答流…',
          result: {
            answer: '',
            sources: [],
            supplementalAnswers: [],
            suggestedActions: [],
            traceId: 'streaming'
          }
        });
        const turn = await workbenchApi.askConversationStream({
          requestId: streamMessageId,
          conversationId,
          message: request.message,
          clientMessageId: nextId('desktop-message'),
          attachmentIds: request.attachmentIds ?? [],
          knowledgeBaseIds: request.knowledgeBaseIds,
          deepMode: deepModeTouched ? deepMode : null
        }, (event) => {
          if (event.type === 'status') {
            setMessages((items) =>
              items.map((item) =>
                item.id === streamMessageId && item.kind === 'answer'
                  ? {
                      ...item,
                      statusText: event.message,
                      activities: [
                        ...(item.activities ?? []).filter(
                          (activity) =>
                            activity.id !== [
                              event.turn ?? 0,
                              event.phase ?? 'status',
                              event.capabilityId ?? ''
                            ].join(':')
                        ),
                        {
                          id: [
                            event.turn ?? 0,
                            event.phase ?? 'status',
                            event.capabilityId ?? ''
                          ].join(':'),
                          phase: event.phase ?? 'status',
                          message: event.message,
                          turn: event.turn,
                          capabilityId: event.capabilityId
                        }
                      ]
                    }
                  : item
              )
            );
          } else if (event.type === 'deep_research_plan') {
            setMessages((items) =>
              items.map((item) =>
                item.id === streamMessageId && item.kind === 'answer'
                  ? {
                      ...item,
                      statusText: `已规划 ${event.subQuestions.length} 个子问题…`,
                      deepResearch: {
                        subQuestions: event.subQuestions,
                        coveredIds: [],
                        confidence: 0,
                        iterations: 0,
                        reflectionRationale: '',
                        missingTopics: []
                      }
                    }
                  : item
              )
            );
          } else if (event.type === 'deep_research_iteration_started') {
            setMessages((items) =>
              items.map((item) =>
                item.id === streamMessageId && item.kind === 'answer'
                  ? {
                      ...item,
                      statusText: `正在研究子问题 ${event.coveredSubQuestions.length > 0 ? event.coveredSubQuestions.length : 1}`,
                      deepResearch: {
                        ...(item.deepResearch ?? {
                          subQuestions: [],
                          coveredIds: [],
                          confidence: 0,
                          iterations: 0,
                          reflectionRationale: '',
                          missingTopics: []
                        }),
                        coveredIds: Array.from(
                          new Set([
                            ...((item.deepResearch?.coveredIds ?? []) as string[]),
                            ...event.coveredSubQuestions
                          ])
                        ),
                        iterations: event.iteration
                      }
                    }
                  : item
              )
            );
          } else if (event.type === 'deep_research_reflection') {
            setMessages((items) =>
              items.map((item) =>
                item.id === streamMessageId && item.kind === 'answer'
                  ? {
                      ...item,
                      statusText: `反思：置信度 ${(event.confidence * 100).toFixed(0)}%，${event.missingTopics.length > 0 ? `仍需研究 ${event.missingTopics.length} 项` : '已足够'}`,
                      deepResearch: {
                        ...(item.deepResearch ?? {
                          subQuestions: [],
                          coveredIds: [],
                          confidence: 0,
                          iterations: 0,
                          reflectionRationale: '',
                          missingTopics: []
                        }),
                        coveredIds: event.coveredSubQuestionIds,
                        confidence: event.confidence,
                        iterations: event.iteration,
                        reflectionRationale: event.rationale,
                        missingTopics: event.missingTopics
                      }
                    }
                  : item
              )
            );
          } else if (event.type === 'deep_research_synthesize_completed') {
            setMessages((items) =>
              items.map((item) =>
                item.id === streamMessageId && item.kind === 'answer'
                  ? {
                      ...item,
                      statusText: '研究综合完成，正在生成最终答案…'
                    }
                  : item
              )
            );
          } else if (event.type === 'candidate_start') {
            cancelDeltaFlush();
            pendingDelta = '';
            activeCandidateId = event.candidateId;
            setMessages((items) =>
              items.map((item) =>
                item.id === streamMessageId && item.kind === 'answer'
                  ? {
                      ...item,
                      statusText: `第 ${event.turn} 轮：正在实时生成…`,
                      result: {
                        ...item.result,
                        answer: ''
                      }
                    }
                  : item
              )
            );
          } else if (
            event.type === 'delta' &&
            (!event.candidateId || event.candidateId === activeCandidateId)
          ) {
            pendingDelta += event.delta;
            scheduleDeltaFlush();
          } else if (
            event.type === 'discard' &&
            event.candidateId === activeCandidateId
          ) {
            cancelDeltaFlush();
            pendingDelta = '';
            activeCandidateId = null;
            setMessages((items) =>
              items.map((item) =>
                item.id === streamMessageId && item.kind === 'answer'
                  ? {
                      ...item,
                      statusText:
                        event.reason === 'tool_use'
                          ? '正在调用工具获取事实，稍后继续回答…'
                          : '上一轮结果尚不完整，正在继续生成…',
                      result: { ...item.result, answer: '' }
                    }
                  : item
              )
            );
          } else if (
            event.type === 'commit' &&
            event.candidateId === activeCandidateId
          ) {
            cancelDeltaFlush();
            pendingDelta = '';
            setMessages((items) =>
              items.map((item) =>
                item.id === streamMessageId && item.kind === 'answer'
                  ? {
                      ...item,
                      statusText: '回答生成完成，正在提交…',
                      result: { ...item.result, answer: event.text }
                    }
                  : item
              )
            );
          } else if (event.type === 'replace') {
            cancelDeltaFlush();
            pendingDelta = '';
            setMessages((items) =>
              items.map((item) =>
                item.id === streamMessageId && item.kind === 'answer'
                  ? {
                      ...item,
                      result: { ...item.result, answer: event.text }
                    }
                  : item
              )
            );
          } else if (event.type === 'skill_install_proposal') {
            skillInstallProposals = [
              ...skillInstallProposals.filter(
                (proposal) => proposal.proposalId !== event.proposal.proposalId
              ),
              event.proposal
            ];
            setMessages((items) =>
              items.map((item) =>
                item.id === streamMessageId && item.kind === 'answer'
                  ? { ...item, skillInstallProposals: [...skillInstallProposals] }
                  : item
              )
            );
          } else if (event.type === 'skill_install_proposals') {
            skillInstallProposals = event.proposals;
            setMessages((items) =>
              items.map((item) =>
                item.id === streamMessageId && item.kind === 'answer'
                  ? { ...item, skillInstallProposals: event.proposals }
                  : item
              )
            );
          } else if (event.type === 'skill_bundle_inspection') {
            skillBundleInspection = event.bundle;
            setMessages((items) =>
              items.map((item) =>
                item.id === streamMessageId && item.kind === 'answer'
                  ? { ...item, skillBundleInspection: event.bundle }
                  : item
              )
            );
          } else if (event.type === 'cli_bundle_inspection') {
            skillBundleInspection = event.bundle;
            setMessages((items) =>
              items.map((item) =>
                item.id === streamMessageId && item.kind === 'answer'
                  ? { ...item, skillBundleInspection: event.bundle }
                  : item
              )
            );
          } else if (event.type === 'skill_workshop_proposal') {
            skillWorkshopProposal = event.proposal;
            setMessages((items) =>
              items.map((item) =>
                item.id === streamMessageId && item.kind === 'answer'
                  ? { ...item, skillWorkshopProposal: event.proposal }
                  : item
              )
            );
          }
        }, requestController.signal);
        flushDeltas();
        let resolvedTurn = turn;
        const browserAction = turn.clientActions.find((action) =>
          action.type === 'browser_extract' &&
          claimClientAction(dispatchedClientActions.current, turn, action)
        );
        if (browserAction) {
          // claimClientAction only succeeds for actions with an id; keep the
          // narrowing explicit because the wire contract remains compatible
          // with older actions where the field was optional.
          const browserActionId = browserAction.actionId as string;
          setMessages((items) =>
            items.map((item) =>
              item.id === streamMessageId && item.kind === 'answer'
                ? {
                    ...item,
                    statusText: '网页接口未取得正文，正在使用内置浏览器读取…',
                    activities: [
                      ...(item.activities ?? []),
                      {
                        id: browserActionId,
                        phase: 'browser_extract',
                        message: '内置浏览器正在打开链接并等待正文稳定',
                        capabilityId: 'workbench.browser_extract'
                      }
                    ]
                  }
                : item
            )
          );
          try {
            await openBrowserPanel();
            const navigation = await browser.execute({
              type: 'navigate',
              url: browserAction.url
            });
            if (!navigation.ok) throw new Error(navigation.message);
            const extraction = await browser.execute({ type: 'extract' });
            if (!extraction.ok || !extraction.extractedText) {
              throw new Error(extraction.message || '页面没有可提取的正文');
            }
            const externalTurn = await workbenchApi.recordExternalResult({
              conversationId,
              clientMessageId: browserActionId,
              runId: turn.runId,
              actionId: browserActionId,
              parentRunId: browserAction.parentRunId,
              baseRevision: browserAction.baseRevision,
              expiresAt: browserAction.expiresAt,
              userMessage: request.message,
              sourceContent: extraction.extractedText,
              sourceType: 'web',
              sourceTitle: extraction.state.title || navigation.state.title || '浏览器页面',
              sourceUri: extraction.state.url || browserAction.url
            });
            if (shouldApplyExternalResult(
              { runId: turn.runId, actionId: browserActionId },
              { runId: externalTurn.runId, actionId: externalTurn.actionId },
              { runId: turn.runId, actionId: browserActionId }
            )) {
              resolvedTurn = {
                ...turn,
                answer: externalTurn.answer,
                sources: externalTurn.sources,
                traceId: externalTurn.traceId,
                clientActions: []
              };
            }
          } catch (browserError) {
            if (isStaleExternalResultError(browserError)) {
              resolvedTurn = turn;
            } else {
            const reason = browserError instanceof Error
              ? browserError.message
              : String(browserError);
            resolvedTurn = {
              ...turn,
              answer: `${turn.answer}\n\n内置浏览器也未能完成正文提取：${reason}`,
              clientActions: []
            };
            }
          }
        }
        // 收集生成的 artifacts 并同步到文档预览上下文
        const generatedArtifacts = (resolvedTurn.artifacts ?? []).map((artifact) => {
          const a = artifact as Record<string, unknown>;
          return {
            artifactId: String(a.artifactId ?? a.artifact_id ?? ''),
            displayName: String(a.displayName ?? a.display_name ?? ''),
            mimeType: (a.mimeType ?? a.mime_type ?? null) as string | null,
            sizeBytes: (a.sizeBytes ?? a.size_bytes ?? null) as number | null,
            artifactType: String(a.artifactType ?? a.artifact_type ?? 'generated_file')
          };
        }).filter((a) => a.artifactId && a.artifactType === 'generated_file');
        generatedArtifacts.forEach((a) => addPreviewArtifact(a));
        // 如果有生成的文件，自动打开预览面板
        if (generatedArtifacts.length > 0) {
          openArtifactPreview(generatedArtifacts[0]);
        }

        setMessages((items) =>
          items.map((item) =>
            item.id === streamMessageId
              ? {
                  id: streamMessageId,
                  role: 'assistant' as const,
                  kind: 'answer' as const,
                  streaming: false,
                  activities: item.kind === 'answer' ? item.activities : [],
                  skillInstallProposals:
                    item.kind === 'answer'
                      ? item.skillInstallProposals ?? skillInstallProposals
                      : skillInstallProposals,
                  skillBundleInspection:
                    item.kind === 'answer'
                      ? item.skillBundleInspection ?? skillBundleInspection
                      : skillBundleInspection,
                  skillWorkshopProposal:
                    item.kind === 'answer'
                      ? item.skillWorkshopProposal ?? skillWorkshopProposal
                      : skillWorkshopProposal,
                  result: {
                    answer: resolvedTurn.answer,
                    sources: resolvedTurn.sources,
                    supplementalAnswers: [],
                    suggestedActions: [],
                    traceId: resolvedTurn.traceId,
                    artifacts: generatedArtifacts
                  }
                }
              : item
          )
        );
      } catch (error) {
        cancelDeltaFlush();
        pendingDelta = '';
        if (
          requestController.signal.aborted ||
          (error instanceof DOMException && error.name === 'AbortError')
        ) {
          const stoppedMessage: AssistantMessage = {
            id: pendingAnswerId ?? nextId('stopped'),
            role: 'assistant',
            kind: 'answer',
            streaming: false,
            result: {
              answer: '已停止生成。请修改或补充输入后重新发送。',
              sources: [],
              supplementalAnswers: [],
              suggestedActions: [],
              traceId: 'cancelled'
            }
          };
          if (pendingAnswerId) upsert(stoppedMessage);
          else commit(stoppedMessage);
          return;
        }
        const errorMessage: AssistantMessage = {
          id: pendingAnswerId ?? nextId('error'),
          role: 'assistant',
          kind: 'error',
          content: error instanceof Error ? error.message : String(error),
          // goal_contract 失败的阶段性结果原文（runtime 已组合"未满足项 +
          // 阶段性结果"），随失败卡片渲染而不是整条丢弃。
          partialAnswer:
            error instanceof ApiError ? error.partialAnswer : undefined,
          request
        };
        if (pendingAnswerId) upsert(errorMessage);
        else commit(errorMessage);
      } finally {
        cancelDeltaFlush();
        if (activeRequestController.current === requestController) {
          activeRequestController.current = null;
          setCanStop(false);
        }
        setBusy(false);
      }
    },
    [
      addPreviewArtifact,
      browser,
      deepMode,
      deepModeTouched,
      ensureConversation,
      openBrowserPanel,
      openArtifactPreview
    ]
  );

  const submit = React.useCallback(
    async (rawMessage: string, override?: Partial<AssistantPageContext>) => {
      // Native file dialogs resolve outside React's event cycle. A user can
      // press Enter before the state-driven rerender installs a fresh submit
      // callback, so read the synchronously updated ref as the authoritative
      // pending-attachment snapshot.
      const pendingAttachments = attachmentsRef.current;
      const message =
        rawMessage.trim() ||
        (pendingAttachments.length > 0 ? '请分析我上传的文件' : '');
      if (!message || busy) return;
      const request = {
        message,
        context: mergeContext(currentContext, override),
        attachmentIds: pendingAttachments.map((item) => item.artifactId),
        knowledgeBaseIds: [...knowledgeBaseIds]
      };
      setOpen(true);
      if (location.pathname === '/') navigate('/assistant');
      setMessages((items) => [
        ...items,
        {
          id: nextId('user'),
          role: 'user',
          kind: 'text',
          content: message,
          attachments: pendingAttachments.map((item) => ({ ...item }))
        }
      ]);
      await runRequest(request);
      try {
        const refreshed = await workbenchApi.listConversations();
        const titledConversationId =
          activeConversationId ?? refreshed[0]?.conversationId;
        setConversations(
          refreshed.map((item) =>
            item.conversationId === titledConversationId && !item.title
              ? { ...item, title: message.slice(0, 36) }
              : item
          )
        );
      } catch {
        if (activeConversationId) {
          setConversations((items) =>
            items.map((item) =>
              item.conversationId === activeConversationId && !item.title
                ? { ...item, title: message.slice(0, 36) }
                : item
            )
          );
        }
      }
      if (attachmentsRef.current === pendingAttachments) {
        clearAttachments();
      }
    },
    [
      activeConversationId,
      busy,
      clearAttachments,
      currentContext,
      knowledgeBaseIds,
      location.pathname,
      navigate,
      runRequest
    ]
  );

  const decideSkillInstallation = React.useCallback(
    async (
      messageId: string,
      proposalId: string,
      decision: 'approve' | 'reject'
    ): Promise<void> => {
      setBusy(true);
      try {
        if (!activeConversationId) throw new Error('当前会话不存在，无法确认安装');
        const result = await workbenchApi.decideSkillInstallation(
          proposalId,
          activeConversationId,
          decision
        );
        setMessages((items) =>
          items.map((item) => {
            if (item.id !== messageId || item.kind !== 'answer') {
              return item;
            }
            const proposals = item.skillInstallProposals ?? (
              item.skillInstallProposal ? [item.skillInstallProposal] : []
            );
            const selectedProposal = proposals.find(
              (proposal) => proposal.proposalId === proposalId
            );
            if (!selectedProposal) return item;
            const status = String(result.status ?? (decision === 'approve' ? 'installed' : 'rejected'));
            const isUninstall = selectedProposal.action === 'uninstall';
            const skillLabel = String(
              result.skillName ?? result.skill_name ?? selectedProposal.displayName
            );
            return {
              ...item,
              skillInstallProposals: proposals.map((proposal) =>
                proposal.proposalId === proposalId ? { ...proposal, status } : proposal
              ),
              skillInstallProposal: undefined,
              result: {
                ...item.result,
                answer:
                  decision === 'approve'
                    ? isUninstall
                      ? `${item.result.answer}\n\nSkill **${skillLabel}** 已卸载，文件已移入本地回收站。`
                      : `${item.result.answer}\n\nSkill **${skillLabel}** 已安装并热加载，现在可以直接在对话中使用。`
                    : `${item.result.answer}\n\n${isUninstall ? '已取消卸载。' : '已取消安装。'}`
              }
            };
          })
        );
      } catch (error) {
        setMessages((items) => [
          ...items,
          {
            id: nextId('skill-install-error'),
            role: 'assistant',
            kind: 'error',
            content: error instanceof Error ? `Skill 安装失败：${error.message}` : 'Skill 安装失败'
          }
        ]);
      } finally {
        setBusy(false);
      }
    },
    [activeConversationId]
  );

  const decideSkillWorkshop = React.useCallback(
    async (
      messageId: string,
      proposalId: string,
      decision: 'approve' | 'reject'
    ): Promise<void> => {
      setBusy(true);
      try {
        if (!activeConversationId) throw new Error('当前会话不存在，无法确认 skill 提案');
        const result = await workbenchApi.decideSkillWorkshop(
          proposalId,
          activeConversationId,
          decision
        );
        setMessages((items) =>
          items.map((item) => {
            if (
              item.id !== messageId ||
              item.kind !== 'answer' ||
              !item.skillWorkshopProposal
            ) {
              return item;
            }
            const status = String(
              result.status ?? (decision === 'approve' ? 'applied' : 'rejected')
            );
            return {
              ...item,
              skillWorkshopProposal: { ...item.skillWorkshopProposal, status },
              result: {
                ...item.result,
                answer:
                  decision === 'approve'
                    ? `${item.result.answer}\n\nSkill **${String(result.skillName ?? item.skillWorkshopProposal.name)}** 已创建并热加载。`
                    : `${item.result.answer}\n\n已取消创建 skill。`
              }
            };
          })
        );
      } catch (error) {
        setMessages((items) => [
          ...items,
          {
            id: nextId('skill-workshop-error'),
            role: 'assistant',
            kind: 'error',
            content: error instanceof Error ? `Skill 创建失败：${error.message}` : 'Skill 创建失败'
          }
        ]);
      } finally {
        setBusy(false);
      }
    },
    [activeConversationId]
  );

  const replaceCommand = React.useCallback((messageId: string, response: CommandResponse) => {
    setMessages((items) =>
      items.map((item) =>
        item.id === messageId && item.kind === 'command'
          ? { ...item, response }
          : item
      )
    );
  }, []);

  const replaceBrowserPlan = React.useCallback(
    (
      messageId: string,
      updater: (plan: BrowserOperationPlan) => BrowserOperationPlan
    ) => {
      setMessages((items) =>
        items.map((item) =>
          item.id === messageId && item.kind === 'browser'
            ? { ...item, plan: updater(item.plan) }
            : item
        )
      );
    },
    []
  );

  const confirmBrowserCommand = React.useCallback(
    async (messageId: string): Promise<void> => {
      if (busy) return;
      const target = messages.find(
        (message): message is Extract<AssistantMessage, { kind: 'browser' }> =>
          message.id === messageId && message.kind === 'browser'
      );
      if (!target) return;
      setBusy(true);
      replaceBrowserPlan(messageId, (plan) => ({
        ...plan,
        status: 'running',
        error: undefined,
        result: undefined,
        steps: plan.steps.map((step) => ({ ...step, status: 'pending' }))
      }));
      let extractedText = '';
      let finalState = browser.state;
      try {
        await openBrowserPanel();
        for (const step of target.plan.steps) {
          replaceBrowserPlan(messageId, (plan) => ({
            ...plan,
            steps: plan.steps.map((item) =>
              item.stepId === step.stepId ? { ...item, status: 'running' } : item
            )
          }));
          const result = await browser.execute(step.action);
          finalState = result.state;
          if (!result.ok) throw new Error(result.message);
          if (result.extractedText) extractedText = result.extractedText;
          replaceBrowserPlan(messageId, (plan) => ({
            ...plan,
            steps: plan.steps.map((item) =>
              item.stepId === step.stepId ? { ...item, status: 'completed' } : item
            )
          }));
        }

        let resultText = `浏览器操作已完成。当前页面：${finalState.title || finalState.url}`;
        let persistedByBackend = false;
        if (extractedText) {
          const fallbackLines = extractedText
            .split('\n')
            .map((line) => line.trim())
            .filter((line, index, items) => line.length >= 12 && items.indexOf(line) === index)
            .slice(0, 40);
          const fallbackSummary = fallbackLines.length
            ? `# ${finalState.title || '网页正文提取'}\n\n` +
              '> 模型总结服务暂时不可用，以下展示浏览器提取到的详细正文要点。\n\n' +
              `${fallbackLines
                .map((line) => line.slice(0, 600))
                .join('\n\n')}\n\n### 来源\n\n- ${finalState.url}`
            : '我已读取页面，但没有找到足够的正文内容。';
          try {
            const conversationId = await ensureConversation();
            const summary = await workbenchApi.recordExternalResult({
              conversationId,
              clientMessageId: target.plan.planId,
              userMessage: target.plan.originalMessage,
              sourceContent: extractedText,
              sourceType: 'web',
              sourceTitle: finalState.title || '浏览器页面',
              sourceUri: finalState.url || undefined
            });
            resultText = summary.answer;
            persistedByBackend = true;
          } catch {
            resultText = fallbackSummary;
          }
        }
        try {
          const conversationId = await ensureConversation();
          if (!persistedByBackend) {
            await workbenchApi.recordExternalResult({
              conversationId,
              clientMessageId: target.plan.planId,
              userMessage: target.plan.originalMessage,
              assistantMessage: resultText,
              sourceType: 'web',
              sourceTitle: finalState.title || '浏览器页面',
              sourceUri: finalState.url || undefined
            });
          }
        } catch {
          // Browser work is still visible; persistence can be retried in a later turn.
        }
        replaceBrowserPlan(messageId, (plan) => ({
          ...plan,
          status: 'succeeded',
          result: resultText
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        replaceBrowserPlan(messageId, (plan) => ({
          ...plan,
          status: 'failed',
          error: message,
          steps: plan.steps.map((step) =>
            step.status === 'running' ? { ...step, status: 'failed' } : step
          )
        }));
      } finally {
        setBusy(false);
      }
    },
    [browser, busy, ensureConversation, messages, openBrowserPanel, replaceBrowserPlan]
  );

  React.useEffect(() => {
    if (busy) return;
    const pending = messages.find(
      (message): message is Extract<AssistantMessage, { kind: 'browser' }> =>
        message.kind === 'browser' &&
        message.plan.status === 'awaiting_confirmation'
    );
    if (pending) void confirmBrowserCommand(pending.id);
  }, [busy, confirmBrowserCommand, messages]);

  const runCommandMutation = React.useCallback(
    async (
      messageId: string,
      operation: () => Promise<CommandResponse>
    ): Promise<void> => {
      setBusy(true);
      try {
        replaceCommand(messageId, await operation());
      } catch (error) {
        setMessages((items) => [
          ...items,
          {
            id: nextId('error'),
            role: 'assistant',
            kind: 'error',
            content: error instanceof Error ? error.message : String(error)
          }
        ]);
      } finally {
        setBusy(false);
      }
    },
    [replaceCommand]
  );

  React.useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
        navigate('/assistant');
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [navigate]);

  const value: AssistantContextValue = {
    open,
    busy,
    canStop,
    context: currentContext,
    messages,
    conversations,
    activeConversationId,
    attachments,
    knowledgeBaseIds,
    setKnowledgeBaseIds,
    deepMode,
    setDeepMode: setDeepModeExplicit,
    selectConversation,
    pickAttachment: async () => {
      try {
        const conversationId = await ensureConversation();
        const result = await workbenchApi.selectAndUploadArtifact(conversationId);
        if (!result.ok) {
          if (!result.cancelled && result.error) throw new Error(result.error);
          return;
        }
        updateAttachments((items) => [
          ...items.filter((item) => item.artifactId !== result.artifact.artifactId),
          {
            artifactId: result.artifact.artifactId,
            displayName: result.artifact.displayName
          }
        ]);
      } catch (error) {
        console.error('pickAttachment failed', error);
        setMessages((items) => [
          ...items,
          {
            id: nextId('error'),
            role: 'assistant',
            kind: 'error',
            content: `附件选择/上传失败：${
              error instanceof Error ? error.message : String(error)
            }`
          }
        ]);
      }
    },
    pasteImage: async ({ mimeType, contentBase64, previewUrl }) => {
      try {
        const conversationId = await ensureConversation();
        const extension = mimeType.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
        const result = await workbenchApi.uploadClipboardImage({
          conversationId,
          filename: `pasted-image-${Date.now()}.${extension}`,
          mimeType,
          contentBase64
        });
        if (!result.ok) {
          if (!result.cancelled && result.error) throw new Error(result.error);
          return;
        }
        updateAttachments((items) => [
          ...items.filter((item) => item.artifactId !== result.artifact.artifactId),
          { ...result.artifact, previewUrl }
        ]);
      } catch (error) {
        setMessages((items) => [...items, {
          id: nextId('error'), role: 'assistant', kind: 'error',
          content: `图片粘贴/上传失败：${error instanceof Error ? error.message : String(error)}`
        }]);
      }
    },
    removeAttachment: (artifactId) => {
      updateAttachments((items) =>
        items.filter((item) => item.artifactId !== artifactId)
      );
    },
    openAssistant: (prompt, override) => {
      setOpen(true);
      navigate('/assistant');
      if (prompt) void submit(prompt, override);
    },
    closeAssistant: () => {
      setOpen(false);
      navigate(-1);
    },
    submit,
    stopGeneration: () => {
      activeRequestController.current?.abort();
    },
    retryMessage: async (messageId) => {
      if (busy) return;
      const target = messages.find((message) => message.id === messageId);
      if (!target) return;
      if (target.kind === 'error' && target.request) {
        await runRequest(target.request, messageId);
        return;
      }
      if (target.kind === 'command' && target.response.command.status === 'failed') {
        const originalMessage = target.response.command.originalMessage?.trim();
        if (!originalMessage) return;
        await runRequest(
          {
            message: originalMessage,
            context: currentContext
          },
          messageId
        );
        return;
      }
      if (target.kind === 'browser' && target.plan.status === 'failed') {
        await confirmBrowserCommand(messageId);
      }
    },
    confirmCommand: async (messageId, command) =>
      runCommandMutation(messageId, () =>
        workbenchApi.confirmCommand(command.commandId, command.version)
      ),
    cancelCommand: async (messageId, command) =>
      runCommandMutation(messageId, () =>
        workbenchApi.cancelCommand(command.commandId, command.version)
      ),
    executeCommandAction: async (messageId, command, actionId) =>
      runCommandMutation(messageId, () =>
        workbenchApi.executeCommandAction(command.commandId, actionId, command.version)
      ),
    confirmBrowserCommand,
    openFilesPanel,
    openArtifactPreview,
    openBrowserPanel,
    decideSkillInstallation,
    decideSkillWorkshop,
    cancelBrowserCommand: async (messageId) => {
      replaceBrowserPlan(messageId, (plan) => ({ ...plan, status: 'cancelled' }));
      await browser.close();
    },
    saveAsAutomation: (command) => {
      const capabilityId = command.steps.find((step) => step.capabilityId)?.capabilityId ?? '';
      const query = new URLSearchParams({
        commandId: command.commandId,
        capabilityId
      });
      setOpen(false);
      navigate(`/triggers?${query.toString()}`);
    },
    clear: () => {
      setMessages([]);
      setActiveConversationId(null);
      clearAttachments();
      setKnowledgeBaseIds([]);
      void browser.close();
      clearPreviewArtifacts();
    }
  };

  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}

export function useAssistant(): AssistantContextValue {
  const value = React.useContext(AssistantContext);
  if (!value) throw new Error('useAssistant must be used inside AssistantProvider');
  return value;
}
