/**
 * End-to-end Playwright smoke test for the renderer.
 *
 * Boots the built renderer with a mock `window.workbenchApi` so the UI can
 * be exercised without the desktop runtime.
 */
import { test, expect } from '@playwright/test';

const FAKE_ANOMALY = {
  anomalyId: 'ANM-001',
  title: '审批超时未处理',
  description: '3 笔审批未在 24 小时内处理',
  severity: 'high',
  status: 'pending',
  sourcePlugin: 'oa',
  sourceCapability: 'oa.approval.timeout_check',
  ownerActorId: 'sup-001',
  occurrenceCount: 3,
  firstSeenAt: '2026-07-26T09:00:00Z',
  lastSeenAt: '2026-07-27T08:00:00Z',
  deepLink: null,
  version: 1
};

const FAKE_TELESALES_WORKSPACE = {
  plan: {
    planId: 'PLAN-1',
    planDate: '2026-07-28',
    targetGmv: 100000,
    targetConversions: 20,
    targetOutboundCalls: 100,
    humanCallsAllocated: 30,
    aiCallsAllocated: 70,
    status: 'draft'
  },
  conversionFunnel: {
    called: 12,
    connected: 9,
    intent: 3,
    aiCalls: 8,
    humanCalls: 4,
    followup: 3
  },
  qualitySummary: {
    totalInspections: 12,
    avgComplianceScore: 94,
    avgQualityScore: 86,
    highRiskCount: 1
  },
  callTargetCompletion: 0.12,
  adjustmentSuggestions: ['存在高风险通话，安排主管复核'],
  merchants: [
    {
      merchantId: 'pilot-hz-001',
      name: '西湖小馆',
      category: '餐饮',
      region: '杭州·西湖',
      phone: '138****8001',
      assignedSalespersonId: 'agent-001',
      tier: 'A',
      lifecycleStage: 'interested',
      version: 2
    }
  ],
  followups: [],
  inspections: [],
  campaigns: [
    {
      campaignId: 'CMP-1',
      name: '沉睡客户唤醒',
      status: 'pending_approval',
      audienceCount: 280,
      excludedCount: 12,
      scheduleWindow: '10:00–18:00',
      scriptVersion: 'V2',
      metrics: {},
      precheck: [{ key: 'opt-out', label: '已排除退订客户', passed: true }],
      version: 1,
      updatedAt: '2026-07-28T09:00:00Z'
    }
  ],
  governance: {
    pendingApprovals: 1,
    queuedExternalEffects: 0,
    completedCampaigns: 0
  }
};

test.beforeEach(async ({ page }) => {
  // Install a deterministic bridge before any user script runs.
  await page.addInitScript(({ anomaly, telesales }) => {
    let retryAttempts = 0;
    let telesalesState = structuredClone(telesales);
    let browserState = {
      available: true,
      mode: 'preview' as const,
      visible: false,
      url: '',
      title: '浏览器预览',
      isLoading: false,
      canGoBack: false,
      canGoForward: false,
      lastError: null as string | null
    };
    const browserListeners = new Set<(state: typeof browserState) => void>();
    const updateBrowserState = (patch: Partial<typeof browserState>) => {
      browserState = { ...browserState, ...patch };
      browserListeners.forEach((listener) => listener(browserState));
      return browserState;
    };
    const assistantPayload = (
      path: string,
      body: {
        answer: string;
        sources: unknown[];
        supplementalAnswers: unknown[];
        suggestedActions: unknown[];
        traceId: string;
      }
    ) =>
      path === '/api/assistant'
        ? body
        : {
            conversationId: 'CNV-E2E',
            userMessageId: 'MSG-USER',
            assistantMessageId: `MSG-${Date.now()}`,
            runId: 'RUN-E2E',
            traceId: body.traceId,
            answer: body.answer,
            generationMode: 'model',
            evidenceStatus: 'matched',
            sources: body.sources,
            artifacts: [],
            memoryStatus: 'recorded',
            duplicate: false
          };
    const fakeApi = {
      async request(input: { method: string; path: string; body?: Record<string, unknown> }) {
        if (input.path.startsWith('/api/conversations?')) {
          return { status: 200, body: { items: [], nextCursor: null } };
        }
        if (input.path === '/api/conversations' && input.method === 'POST') {
          return {
            status: 201,
            body: {
              conversationId: 'CNV-E2E',
              title: '',
              conversationType: 'assistant',
              status: 'active',
              lastSequence: 0,
              lastMessageAt: null,
              createdAt: '2026-07-29T00:00:00Z',
              updatedAt: '2026-07-29T00:00:00Z'
            }
          };
        }
        if (input.path.includes('/messages?limit=200')) {
          return {
            status: 200,
            body: {
              conversationId: 'CNV-E2E',
              messages: [],
              nextAfterSequence: 0,
              hasMore: false
            }
          };
        }
        if (/^\/api\/conversations\/[^/]+\/external-result$/.test(input.path)) {
          const sourceContent = String(input.body?.source_content ?? '');
          const assistantMessage = String(input.body?.assistant_message ?? '');
          return {
            status: 200,
            body: {
              conversationId: 'CNV-E2E',
              userMessageId: 'MSG-EXTERNAL-USER',
              assistantMessageId: 'MSG-EXTERNAL-ASSISTANT',
              runId: 'RUN-EXTERNAL',
              traceId: 'trace-external',
              answer: sourceContent
                ? `# 页面详细总结\n\n## 核心内容\n\n${sourceContent}\n\n已处理 ${sourceContent.length} 个字符。`
                : assistantMessage,
              generationMode: sourceContent
                ? 'browser_content_model'
                : `${String(input.body?.source_type ?? 'tool')}_result`,
              evidenceStatus: 'matched',
              sources: [],
              artifacts: [],
              memoryStatus: 'recorded',
              duplicate: false
            }
          };
        }
        if (input.path.startsWith('/api/telesales/workspace?')) {
          return { status: 200, body: telesalesState };
        }
        if (input.path === '/api/outbound-campaigns/CMP-1/approve') {
          telesalesState = {
            ...telesalesState,
            campaigns: telesalesState.campaigns.map((campaign) =>
              campaign.campaignId === 'CMP-1'
                ? { ...campaign, status: 'approved', version: campaign.version + 1 }
                : campaign
            ),
            governance: {
              ...telesalesState.governance,
              pendingApprovals: 0
            }
          };
          return { status: 200, body: telesalesState.campaigns[0] };
        }
        if (input.path === '/api/outbound-campaigns/CMP-1/start') {
          telesalesState = {
            ...telesalesState,
            campaigns: telesalesState.campaigns.map((campaign) =>
              campaign.campaignId === 'CMP-1'
                ? { ...campaign, status: 'queued', version: campaign.version + 1 }
                : campaign
            ),
            governance: {
              ...telesalesState.governance,
              queuedExternalEffects: 1
            }
          };
          return { status: 202, body: telesalesState.campaigns[0] };
        }
        if (input.path === '/api/telesales/merchants/pilot-hz-001/simulate-call') {
          telesalesState = {
            ...telesalesState,
            conversionFunnel: {
              ...telesalesState.conversionFunnel,
              called: telesalesState.conversionFunnel.called + 1,
              connected: telesalesState.conversionFunnel.connected + 1,
              intent: telesalesState.conversionFunnel.intent + 1,
              aiCalls: telesalesState.conversionFunnel.aiCalls + 1
            },
            qualitySummary: {
              ...telesalesState.qualitySummary,
              totalInspections: telesalesState.qualitySummary.totalInspections + 1
            },
            campaigns: telesalesState.campaigns.map((campaign) =>
              campaign.campaignId === 'CMP-1'
                ? { ...campaign, status: 'completed', version: campaign.version + 1 }
                : campaign
            )
          };
          return { status: 200, body: { outcome: 'intent' } };
        }
        if (input.path === '/api/approvals') {
          return {
            status: 200,
            body: [
              {
                approvalId: 'APR-1',
                summary: '发送本周销售报告',
                status: 'pending',
                objectType: 'command',
                objectId: 'CMD-1',
                requestedBy: 'sup-001',
                createdAt: '2026-07-28T09:00:00Z'
              }
            ]
          };
        }
        if (input.path.startsWith('/api/commands?')) {
          return {
            status: 200,
            body: [
              {
                commandId: 'CMD-1',
                message: '分析三个业绩下降最大的门店',
                status: 'awaiting_confirmation',
                version: 1,
                traceId: 'trace-command',
                updatedAt: '2026-07-28T10:15:00Z'
              }
            ]
          };
        }
        if (input.path === '/api/triggers') {
          return { status: 200, body: { items: [], nextCursor: null } };
        }
        if (input.path === '/api/commands/preview') {
          const message = String(input.body?.message ?? '');
          if (message.includes('重新执行测试') && retryAttempts++ === 0) {
            return {
              status: 503,
              body: {
                error: {
                  code: 'TEMPORARY_UNAVAILABLE',
                  message: 'request failed'
                }
              }
            };
          }
          if (message.includes('分析三个')) {
            return {
              status: 200,
              body: {
                kind: 'command',
                message: '执行计划已生成，请确认后开始。',
                command: {
                  commandId: 'CMD-PLAN',
                  status: 'awaiting_confirmation',
                  version: 1,
                  originalMessage: message,
                  intent: {},
                  steps: [
                    { stepId: 'S1', label: '拉取门店目标', capabilityId: 'report.target.read' },
                    { stepId: 'S2', label: '拉取实际数据', capabilityId: 'report.actual.read' },
                    { stepId: 'S3', label: '计算偏差', capabilityId: 'analytics.gap.calculate' },
                    { stepId: 'S4', label: '生成跟进清单', capabilityId: 'crm.followup.create' }
                  ],
                  policy: {
                    allowed: true,
                    allowedRoles: ['supervisor'],
                    blockers: [],
                    requiresDownstreamApproval: true
                  },
                  execution: { nextActions: [], stepResults: [] },
                  traceId: 'trace-plan'
                }
              }
            };
          }
          return {
            status: 200,
            body: { kind: 'question', message: '这是一个问答请求', traceId: 'trace-question' }
          };
        }
        if (
          input.path === '/api/assistant' ||
          /^\/api\/conversations\/[^/]+\/assistant$/.test(input.path)
        ) {
          const message = String(input.body?.message ?? '');
          if (message.includes('<browser_content>')) {
            return {
              status: 200,
              body: assistantPayload(input.path, {
                answer: '正式员工每年享有 5–15 天带薪年假。',
                sources: [
                  {
                    type: 'knowledge',
                    title: '《员工休假管理制度》第 3.2 条',
                    uri: 'https://example.com/policy/leave'
                  }
                ],
                supplementalAnswers: [],
                suggestedActions: [],
                traceId: 'trace-irrelevant-browser-summary'
              })
            };
          }
          if (message.includes('高意向客户')) {
            return {
              status: 200,
              body: assistantPayload(input.path, {
                answer: '今天共识别 2 个高意向客户，均已创建人工跟进任务。',
                sources: [
                  {
                    type: 'business',
                    title: '今日电话销售结果',
                    uri: null,
                    abstract: '当天已完成通话的权威业务记录'
                  }
                ],
                supplementalAnswers: [],
                suggestedActions: [],
                traceId: 'trace-high-intent'
              })
            };
          }
          if (message.includes('济南天气')) {
            return {
              status: 200,
              body: assistantPayload(input.path, {
                answer:
                  '企业知识库未命中，以下回答基于公开实时天气数据。\n\n1. **当前天气**：山东济南今天雷暴，当前 31.8°C。\n2. **今日预报**：最高 34.8°C、最低 25.8°C，最高降水概率 92%。[1]',
                sources: [
                  {
                    type: 'web',
                    title: 'Open-Meteo · 山东济南天气',
                    uri: 'https://api.open-meteo.com/v1/forecast',
                    publisher: 'Open-Meteo',
                    snippet: '公开实时天气与预报数据',
                    score: null
                  }
                ],
                supplementalAnswers: [],
                suggestedActions: [],
                traceId: 'trace-weather'
              })
            };
          }
          return {
            status: 200,
            body: assistantPayload(input.path, {
              answer: '正式员工每年享有 5–15 天带薪年假，具体天数取决于累计工作年限。',
              sources: [
                {
                  type: 'knowledge',
                  title: '《员工休假管理制度》第 3.2 条',
                  uri: 'https://example.com/policy/leave',
                  snippet: '员工年假天数根据累计工作年限确定。'
                }
              ],
              supplementalAnswers: [],
              suggestedActions: [{ id: 'leave-flow', label: '查看请假流程' }],
              traceId: 'trace-answer'
            })
          };
        }
        if (input.path === '/api/commands/CMD-PLAN/confirm') {
          return {
            status: 200,
            body: {
              kind: 'command',
              message: '任务执行完成。',
              command: {
                commandId: 'CMD-PLAN',
                status: 'succeeded',
                version: 2,
                originalMessage: '分析三个业绩下降最大的门店',
                intent: {},
                steps: [
                  { stepId: 'S1', label: '拉取门店目标', capabilityId: 'report.target.read', status: 'completed' },
                  { stepId: 'S2', label: '生成跟进清单', capabilityId: 'crm.followup.create', status: 'completed' }
                ],
                policy: { allowed: true, allowedRoles: ['supervisor'], blockers: [] },
                execution: {
                  nextActions: [],
                  stepResults: [
                    {
                      stepId: 'S1',
                      message: '已完成门店业绩诊断并生成跟进清单',
                      objectType: 'store_diagnosis',
                      objectId: 'DIAG-1'
                    }
                  ]
                },
                traceId: 'trace-plan'
              }
            }
          };
        }
        if (input.path === '/api/knowledge/bases') {
          return {
            status: 200,
            body: {
              knowledgeBases: [
                {
                  knowledgeBaseId: 'KB-GENERAL',
                  tenantId: 'tenant-a',
                  name: '企业制度知识库',
                  description: '企业制度与流程',
                  domain: 'enterprise_policy',
                  routingKeywords: ['年假', '制度'],
                  isDefault: true,
                  enabled: true,
                  createdBy: 'sup-001',
                  createdAt: '2026-07-01T09:00:00Z',
                  updatedAt: '2026-07-28T09:00:00Z'
                }
              ]
            }
          };
        }
        if (input.path.startsWith('/api/knowledge/documents')) {
          return {
            status: 200,
            body: {
              documents: [
                {
                  docId: 'DOC-1',
                  tenantId: 'tenant-a',
                  knowledgeBaseId: 'KB-GENERAL',
                  knowledgeBaseName: '企业制度知识库',
                  domain: 'enterprise_policy',
                  title: '员工休假管理制度',
                  uri: 'https://example.com/policy/leave',
                  chunkCount: 4,
                  charCount: 1200,
                  createdAt: '2026-07-01T09:00:00Z',
                  updatedAt: '2026-07-28T09:00:00Z'
                }
              ]
            }
          };
        }
        if (input.path.startsWith('/api/anomalies?') || input.path === '/api/anomalies') {
          return { status: 200, body: { items: [anomaly], nextCursor: null } };
        }
        if (input.path === `/api/anomalies/${encodeURIComponent(anomaly.anomalyId)}`) {
          return {
            status: 200,
            body: {
              ...anomaly,
              conversationId: 'CNV-1',
              verificationArtifactId: 'VER-1',
              traceId: 'trace-1',
              snapshot: { capturedAt: '2026-07-27T08:00:00Z', schemaVersion: 1, fields: { leave_id: 'L-9' } },
              occurrences: [
                {
                  occurrenceId: 'OCC-1',
                  commandId: 'CMD-1',
                  errorCode: 'TIMEOUT',
                  occurredAt: '2026-07-27T08:00:00Z',
                  message: 'OA did not respond in 5s'
                }
              ]
            }
          };
        }
        return { status: 200, body: {} };
      },
      async streamAssistant(
        input: {
          requestId: string;
          conversationId: string;
          message: string;
          clientMessageId: string;
          attachmentIds: string[];
        },
        listener: (event: Record<string, unknown>) => void
      ) {
        let cancelled = false;
        const answerBody = input.message.includes('github.com/KKKKhazix')
          ? input.message.includes('安装')
            ? {
                answer:
                  '已识别为 GitHub skill 安装请求：会话 agent 将先检查 SKILL.md 和锁定版本，再生成需要你确认的安装提案。',
                sources: [],
                supplementalAnswers: [],
                suggestedActions: [],
                traceId: 'trace-github-skill-install'
              }
            : {
                answer:
                  'hv-analysis 是一个横纵双轴深度研究 skill：纵向追踪发展历程，横向对比同期竞品，最后产出研究报告。',
                sources: [],
                supplementalAnswers: [],
                suggestedActions: [],
                traceId: 'trace-github-analysis'
              }
          : input.message.includes('打开浏览器') || input.message.includes('今日的热点新闻')
            ? {
                answer:
                  '已由会话 agent 理解目标并完成网页信息总结，不会把“打开”当作任务终点。',
                sources: [],
                supplementalAnswers: [],
                suggestedActions: [],
                traceId: 'trace-browser-via-agent'
              }
          : input.message.includes('济南天气')
          ? {
              answer:
                '企业知识库未命中，以下回答基于公开实时天气数据。\n\n1. **当前天气**：山东济南今天雷暴，当前 31.8°C。\n2. **今日预报**：最高 34.8°C、最低 25.8°C，最高降水概率 92%。[1]',
              sources: [
                {
                  type: 'web',
                  title: 'Open-Meteo · 山东济南天气',
                  uri: 'https://api.open-meteo.com/v1/forecast',
                  publisher: 'Open-Meteo',
                  snippet: '公开实时天气与预报数据',
                  score: null
                }
              ],
              supplementalAnswers: [],
              suggestedActions: [],
              traceId: 'trace-weather'
            }
          : input.message.includes('高意向客户')
            ? {
                answer: '今天共识别 2 个高意向客户，均已创建人工跟进任务。',
                sources: [
                  {
                    type: 'business',
                    title: '今日电话销售结果',
                    uri: null,
                    abstract: '当天已完成通话的权威业务记录'
                  }
                ],
                supplementalAnswers: [],
                suggestedActions: [],
                traceId: 'trace-high-intent'
              }
            : {
                answer:
                  '正式员工每年享有 5–15 天带薪年假，具体天数取决于累计工作年限。',
                sources: [
                  {
                    type: 'knowledge',
                    title: '《员工休假管理制度》第 3.2 条',
                    uri: 'https://example.com/policy/leave',
                    snippet: '员工年假天数根据累计工作年限确定。'
                  }
                ],
                supplementalAnswers: [],
                suggestedActions: [{ id: 'leave-flow', label: '查看请假流程' }],
                traceId: 'trace-answer'
              };
        const turn = assistantPayload(
          `/api/conversations/${input.conversationId}/assistant`,
          answerBody
        );
        listener({
          type: 'accepted',
          clientMessageId: input.clientMessageId,
          runId: `RUN-${input.clientMessageId}`
        });
        listener({ type: 'status', message: '正在检索知识与业务上下文…' });
        void (async () => {
          await new Promise((resolve) =>
            window.setTimeout(
              resolve,
              input.message.includes('没有输入完整') ? 1_000 : 80
            )
          );
          const answer = answerBody.answer;
          for (let offset = 0, index = 0; offset < answer.length; offset += 28, index += 1) {
            if (cancelled) return;
            listener({
              type: 'delta',
              index,
              delta: answer.slice(offset, offset + 28)
            });
            await new Promise((resolve) => window.setTimeout(resolve, 30));
          }
          if (!cancelled) listener({ type: 'completed', turn });
        })();
        return () => {
          cancelled = true;
        };
      },
      async subscribeAnomalies() {
        return () => {};
      },
      async openVerificationArtifact() {
        return null;
      },
      async getSession() {
        if (new URLSearchParams(window.location.search).get('setup') === '1') {
          return { tenantId: '', actorId: '', baseUrl: '', hasApiKey: false };
        }
        return { tenantId: 'tenant-a', actorId: 'sup-001', baseUrl: 'http://127.0.0.1:8080', hasApiKey: true };
      },
      async updateSession(input: { tenantId?: string; actorId?: string; baseUrl?: string; apiKey?: string }) {
        if (input.apiKey === 'bad-key') {
          return {
            ok: false,
            error: {
              code: 'CONNECTION_FAILED',
              message: '连接验证失败：invalid API key'
            }
          };
        }
        return {
          ok: true,
          session: {
            tenantId: input.tenantId ?? '',
            actorId: input.actorId ?? '',
            baseUrl: input.baseUrl ?? '',
            hasApiKey: Boolean(input.apiKey)
          }
        };
      },
      async browserGetState() {
        return browserState;
      },
      async browserSetVisible(visible: boolean) {
        return updateBrowserState({ visible });
      },
      async browserSetBounds() {
        return browserState;
      },
      async browserNavigate(url: string) {
        const parsed = new URL(url);
        const isBaiduNews = parsed.hostname === 'news.baidu.com';
        return {
          ok: true,
          message: `已打开 ${parsed.hostname}`,
          state: updateBrowserState({
            visible: true,
            url: parsed.href,
            title: isBaiduNews ? '百度新闻——海量中文资讯平台' : 'OpenAI 搜索结果',
            isLoading: false,
            lastError: null
          })
        };
      },
      async browserAction(action: { type: string; url?: string }) {
        if (action.type === 'navigate' && action.url) {
          return fakeApi.browserNavigate(action.url);
        }
        if (action.type === 'extract') {
          const extractedText = browserState.url.includes('news.baidu.com')
            ? '百度新闻今日热点：国内要闻、国际动态和科技资讯持续更新。'
            : 'OpenAI 发布产品更新。研究团队公布新的模型进展和安全评估。';
          return {
            ok: true,
            message: '已读取当前页面内容',
            state: browserState,
            extractedText
          };
        }
        return { ok: true, message: '操作完成', state: browserState };
      },
      async subscribeBrowserState(listener: (state: typeof browserState) => void) {
        browserListeners.add(listener);
        listener(browserState);
        return () => browserListeners.delete(listener);
      }
    };
    (window as unknown as { workbenchApi: typeof fakeApi }).workbenchApi = fakeApi;
  }, { anomaly: FAKE_ANOMALY, telesales: FAKE_TELESALES_WORKSPACE });
});

test('loads the AI workbench home and opens knowledge Q&A', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('home-page')).toBeVisible({ timeout: 5000 });
  await page.getByTestId('home-assistant-input').fill('公司的年假可以请几天？');
  await page.getByTestId('home-assistant-input').press('Enter');
  await expect(page).toHaveURL(/\/assistant$/);
  await expect(page.getByTestId('assistant-page')).toBeVisible();
  await expect(page.getByTestId('assistant-answer')).toContainText('5–15 天');
  await expect(
    page.getByTestId('assistant-answer').getByText('《员工休假管理制度》第 3.2 条')
  ).toBeVisible();
});

test('streams an assistant answer before publishing the completed turn', async ({
  page
}) => {
  await page.goto('/#/assistant');
  await page.getByTestId('assistant-input').fill('公司的年假可以请几天？');
  await page.getByTestId('assistant-input').press('Enter');

  await expect(page.getByTestId('assistant-stream-status')).toContainText(
    '正在检索知识与业务上下文'
  );
  await expect(page.getByTestId('assistant-answer')).toContainText('正式员工每年');
  await expect(page.getByTestId('assistant-answer')).toContainText('累计工作年限');
  await expect(page.getByTestId('assistant-stream-status')).toHaveCount(0);
  await expect(
    page.getByTestId('assistant-answer').getByText('《员工休假管理制度》第 3.2 条')
  ).toBeVisible();
});

test('stops an in-flight assistant answer and allows a corrected query', async ({
  page
}) => {
  await page.goto('/#/assistant');
  await page.getByTestId('assistant-input').fill('这是一个没有输入完整的问');
  await page.getByTestId('assistant-input').press('Enter');

  await expect(page.getByTestId('assistant-stop')).toBeVisible();
  await page.getByTestId('assistant-stop').click();
  await expect(page.getByTestId('assistant-answer')).toContainText('已停止生成');
  await expect(page.getByTestId('assistant-stop')).toHaveCount(0);

  await page.getByTestId('assistant-input').fill('这是重新输入后的完整问题');
  await expect(page.getByTestId('assistant-send')).toBeEnabled();
});

test('routes a public weather query to realtime data without business clarification', async ({
  page
}) => {
  await page.goto('/');
  await page.getByTestId('home-assistant-input').fill('今天济南天气');
  await page.getByTestId('home-assistant-input').press('Enter');

  await expect(page).toHaveURL(/\/assistant$/);
  await expect(page.getByTestId('assistant-answer')).toContainText('山东济南今天雷暴');
  await expect(page.getByTestId('assistant-answer')).not.toContainText('请补充');
  await expect(
    page
      .getByTestId('assistant-answer')
      .locator('.assistant-markdown')
      .getByText('当前天气', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByTestId('assistant-answer').locator('.assistant-markdown ol')
  ).toBeVisible();
  await expect(
    page.getByTestId('assistant-answer').getByText('Open-Meteo · 山东济南天气')
  ).toBeVisible();
});

test('keeps a business workflow inside the conversation workbench', async ({ page }) => {
  await page.goto('/');
  await page
    .getByTestId('home-assistant-input')
    .fill('分析三个业绩下降最大的门店');
  await page.getByTestId('home-assistant-input').press('Enter');

  await expect(page).toHaveURL(/\/assistant$/);
  await expect(page.getByTestId('command-stage-rail')).toBeVisible();
  await expect(page.getByTestId('command-results')).toContainText(
    '已完成门店业绩诊断并生成跟进清单'
  );
  await expect(page.getByText('拉取门店目标')).toBeVisible();
  await expect(page.getByText('生成跟进清单')).toBeVisible();
  await expect(page.getByRole('complementary', { name: '对话上下文' })).toBeVisible();
});

test('renders a high-intent summary when an optional source URI is null', async ({ page }) => {
  await page.goto('/#/assistant');
  await page.getByRole('button', { name: /总结今天高意向客户/ }).click();

  await expect(page.getByTestId('assistant-answer')).toContainText(
    '今天共识别 2 个高意向客户'
  );
  await expect(
    page.getByTestId('assistant-answer').getByText('今日电话销售结果')
  ).toBeVisible();
  await expect(page.getByTestId('assistant-error')).toHaveCount(0);
});

test('routes browser wording through the agent instead of a renderer shortcut', async ({
  page
}) => {
  await page.goto('/#/assistant');
  await page
    .getByTestId('assistant-input')
    .fill('打开浏览器，搜索 OpenAI 最新消息并总结');
  await page.getByTestId('assistant-input').press('Enter');

  await expect(page.getByTestId('assistant-answer')).toContainText(
    '不会把“打开”当作任务终点'
  );
  await expect(page.getByTestId('assistant-browser-command')).toHaveCount(0);
  await expect(page.getByTestId('browser-panel')).toHaveCount(0);
});

test('routes a GitHub URL analysis query through the conversation agent', async ({ page }) => {
  await page.goto('/#/assistant');
  await page
    .getByTestId('assistant-input')
    .fill('分析链接 https://github.com/KKKKhazix/khazix-skills/tree/main/hv-analysis 中的这个项目是干嘛的');
  await page.getByTestId('assistant-input').press('Enter');

  await expect(page.getByTestId('assistant-answer')).toContainText('横纵双轴深度研究');
  await expect(page.getByTestId('assistant-browser-command')).toHaveCount(0);
  await expect(page.getByTestId('browser-panel')).toHaveCount(0);
});

test('routes a GitHub skill install query to the agent instead of opening the URL', async ({
  page
}) => {
  await page.goto('/#/assistant');
  await page
    .getByTestId('assistant-input')
    .fill('https://github.com/KKKKhazix/khazix-skills/tree/main/hv-analysis\n安装这个skill');
  await page.getByTestId('assistant-input').press('Enter');

  await expect(page.getByTestId('assistant-answer')).toContainText(
    '检查 SKILL.md 和锁定版本'
  );
  await expect(page.getByTestId('assistant-browser-command')).toHaveCount(0);
  await expect(page.getByTestId('browser-panel')).toHaveCount(0);
});

test('retries a failed assistant request without duplicating the user message', async ({
  page
}) => {
  await page.goto('/');
  await page.getByTestId('home-assistant-input').fill('重新执行测试');
  await page.getByTestId('home-assistant-input').press('Enter');

  await expect(page.getByTestId('assistant-error')).toContainText('request failed');
  await expect(page.getByTestId('assistant-retry')).toBeVisible();
  await expect(page.getByText('重新执行测试', { exact: true })).toHaveCount(1);

  await page.getByTestId('assistant-retry').click();

  await expect(page.getByTestId('assistant-answer')).toContainText('带薪年假');
  await expect(page.getByTestId('assistant-error')).toHaveCount(0);
  await expect(page.getByText('重新执行测试', { exact: true })).toHaveCount(1);
});

test('does not expose embedded development credentials to first-time users', async ({ page }) => {
  await page.goto('/#/?setup=1');
  await expect(page.getByTestId('need-credentials')).toBeVisible();
  await expect(page.getByTestId('settings-base-url')).toHaveValue('http://127.0.0.1:8000');
  await expect(page.getByTestId('settings-api-key')).toHaveValue('');
  await expect(page.getByTestId('settings-tenant')).toHaveValue('tenant-a');
  await expect(page.getByTestId('settings-actor')).toHaveValue('sup-001');
  await page.getByTestId('settings-api-key').fill('test-key');
  await page.getByTestId('settings-save').click();
  await expect(page.getByTestId('home-page')).toBeVisible();
});

test('does not offer a development-default reset for an existing session', async ({ page }) => {
  await page.goto('/#/settings');
  await expect(page.getByTestId('settings-api-key')).toHaveValue('');
  await expect(page.getByTestId('settings-use-defaults')).toHaveCount(0);
});

test('keeps the user in settings when connection validation fails', async ({ page }) => {
  await page.goto('/#/?setup=1');
  await page.getByTestId('settings-api-key').fill('bad-key');
  await page.getByTestId('settings-save').click();
  await expect(page.getByTestId('settings-error')).toContainText('invalid API key');
  await expect(page.getByTestId('settings-page')).toBeVisible();
  await expect(page.getByTestId('home-page')).not.toBeVisible();
});

test('automatically executes a clear natural-language command', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('home-assistant-input').fill('分析三个业绩下降最大的门店');
  await page.getByTestId('home-assistant-input').press('Enter');
  await expect(page.getByTestId('assistant-page')).toBeVisible();
  await expect(page.getByTestId('assistant-command')).toContainText('执行计划');
  await expect(page.getByText('拉取门店目标')).toBeVisible();
  await expect(page.getByTestId('assistant-command')).toContainText('任务执行完成');
  await expect(page.getByTestId('confirm-command')).toHaveCount(0);
  await expect(page.getByText('保存为自动化')).toBeVisible();
});

test('loads /anomalies and shows mocked list', async ({ page }) => {
  await page.goto('/#/anomalies');
  await expect(page.getByTestId('shell')).toBeVisible({ timeout: 5000 });
});

test('clicking an anomaly opens its detail', async ({ page }) => {
  await page.goto('/#/anomalies/ANM-001');
  await expect(page.getByTestId('shell')).toBeVisible();
  // Detail page renders the snapshot viewer once the async fetch resolves.
  await expect(page.getByTestId('snapshot')).toBeVisible({ timeout: 5000 });
});

test('knowledge page lists indexed documents', async ({ page }) => {
  await page.goto('/#/knowledge');
  await expect(page.getByTestId('knowledge-page')).toBeVisible();
  await expect(page.getByText('员工休假管理制度')).toBeVisible();
  await expect(page.getByRole('button', { name: '向 AI 提问' })).toBeVisible();
});

test('home remains usable at a compact viewport', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 820 });
  await page.goto('/');
  await expect(page.getByTestId('home-page')).toBeVisible();
  await expect(page.getByTestId('home-assistant-input')).toBeVisible();
  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  );
  expect(hasHorizontalOverflow).toBe(false);
});
