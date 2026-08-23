/**
 * Shared contracts between main / preload / renderer.
 *
 * IMPORTANT: every IPC payload is validated against a Zod schema before it
 * leaves main and again before the renderer hands it to React. The renderer
 * never trusts raw objects; the preload bridge is the only ingress.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Session / credentials
// ---------------------------------------------------------------------------

export const SessionStateSchema = z.object({
  tenantId: z.string().min(1).max(64),
  actorId: z.string().min(1).max(64),
  baseUrl: z.string().url(),
  // hasApiKey is true iff safeStorage successfully encrypted a key. The key
  // itself NEVER crosses the IPC boundary.
  hasApiKey: z.boolean()
});

export type SessionState = z.infer<typeof SessionStateSchema>;

export const SessionUpdateSchema = z
  .object({
    apiKey: z.string().min(1).max(512).optional(),
    tenantId: z.string().min(1).max(64).optional(),
    actorId: z.string().min(1).max(64).optional(),
    baseUrl: z.string().url().optional()
  })
  .strict()
  .refine(
    (value) =>
      value.apiKey !== undefined ||
      value.tenantId !== undefined ||
      value.actorId !== undefined ||
      value.baseUrl !== undefined,
    { message: 'updateSession requires at least one field' }
  );

export type SessionUpdate = z.infer<typeof SessionUpdateSchema>;

export const AccountAuthenticationSchema = z
  .object({
    mode: z.enum(['signup', 'login']),
    baseUrl: z.string().url(),
    email: z.string().email().max(254),
    password: z.string().min(8).max(256),
    displayName: z.string().min(1).max(80).optional(),
    verificationCode: z
      .string()
      .regex(/^\d{6}$/, 'verificationCode must be 6 digits')
      .optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.mode === 'signup' && !value.displayName) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['displayName'],
        message: 'displayName is required for signup'
      });
    }
  });

export type AccountAuthentication = z.infer<typeof AccountAuthenticationSchema>;

// ---------------------------------------------------------------------------
// Email verification code (registration)
// ---------------------------------------------------------------------------

export const EmailCodeRequestSchema = z
  .object({
    baseUrl: z.string().url(),
    email: z.string().email().max(254)
  })
  .strict();

export type EmailCodeRequest = z.infer<typeof EmailCodeRequestSchema>;

export const EmailCodeResponseSchema = z.object({
  ok: z.literal(true),
  expires_in_seconds: z.number().int().min(30).max(3_600),
  retry_after_seconds: z.number().int().min(0).max(600)
});

export type EmailCodeResponse = z.infer<typeof EmailCodeResponseSchema>;

export const EmailCodeErrorSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    retry_after_seconds: z.number().int().min(0).max(3_600).optional()
  })
});

export type EmailCodeError = z.infer<typeof EmailCodeErrorSchema>;

// ---------------------------------------------------------------------------
// Generic request envelope (the only way the renderer talks to backend)
// ---------------------------------------------------------------------------

export const HttpMethodSchema = z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']);

export const RequestInputSchema = z.object({
  method: HttpMethodSchema,
  path: z
    .string()
    .min(1)
    .max(512)
    .regex(/^\/api\/[a-z0-9_%:\-/]+(\?.*)?$/i, 'path must start with /api/'),
  body: z.unknown().optional(),
  // Optional idempotency key (POST/PUT).
  idempotencyKey: z.string().min(1).max(128).optional(),
  // Optional If-Match / X-Expected-Version (for optimistic concurrency).
  expectedVersion: z.number().int().min(0).optional(),
  // Long-running model-backed operations can opt into a larger bounded timeout.
  timeoutMs: z.number().int().min(1_000).max(180_000).optional(),
  // Stream-style request (returns IPC events instead of a single response).
  stream: z.boolean().optional()
});

export type RequestInput = z.infer<typeof RequestInputSchema>;

export const RequestErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  status: z.number().int().min(400).max(599)
});

export type RequestError = z.infer<typeof RequestErrorSchema>;

export const RequestResponseSchema = z.object({
  status: z.number().int().min(100).max(599),
  body: z.unknown()
});

export type RequestResponse = z.infer<typeof RequestResponseSchema>;

// ---------------------------------------------------------------------------
// Anomaly domain
// ---------------------------------------------------------------------------

export const AnomalySeveritySchema = z.enum(['low', 'medium', 'high', 'critical']);
export const AnomalyStatusSchema = z.enum([
  'pending',
  'fixing',
  'awaiting_approval',
  'verifying',
  'resolved',
  'ignored'
]);

export const AnomalySchema = z.object({
  anomalyId: z.string(),
  title: z.string(),
  description: z.string(),
  severity: AnomalySeveritySchema,
  status: AnomalyStatusSchema,
  sourcePlugin: z.string(),
  sourceCapability: z.string(),
  ownerActorId: z.string().nullable(),
  occurrenceCount: z.number().int().min(0),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  deepLink: z.string().url().nullable(),
  version: z.number().int().min(1)
});

export type Anomaly = z.infer<typeof AnomalySchema>;

export const AnomalyDetailSchema = AnomalySchema.extend({
  occurrences: z.array(
    z.object({
      occurrenceId: z.string(),
      commandId: z.string().nullable(),
      errorCode: z.string().nullable(),
      occurredAt: z.string(),
      message: z.string()
    })
  ),
  conversationId: z.string().nullable(),
  verificationArtifactId: z.string().nullable(),
  traceId: z.string(),
  snapshot: z
    .object({
      capturedAt: z.string(),
      schemaVersion: z.number().int().min(1),
      fields: z.record(z.string(), z.unknown())
    })
    .nullable()
});

export type AnomalyDetail = z.infer<typeof AnomalyDetailSchema>;

export const AnomalyListResponseSchema = z.object({
  items: z.array(AnomalySchema),
  nextCursor: z.string().nullable()
});

export type AnomalyListResponse = z.infer<typeof AnomalyListResponseSchema>;

// SSE event schemas
export const AnomalyStreamEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('anomaly.opened'),
    seq: z.number().int().min(0),
    anomaly: AnomalySchema
  }),
  z.object({
    type: z.literal('anomaly.updated'),
    seq: z.number().int().min(0),
    anomaly: AnomalySchema
  }),
  z.object({
    type: z.literal('anomaly.resolved'),
    seq: z.number().int().min(0),
    anomalyId: z.string()
  }),
  z.object({
    type: z.literal('heartbeat'),
    seq: z.number().int().min(0),
    sentAt: z.string()
  })
]);

export type AnomalyStreamEvent = z.infer<typeof AnomalyStreamEventSchema>;

// ---------------------------------------------------------------------------
// Trigger domain
// ---------------------------------------------------------------------------

export const TriggerTypeSchema = z.enum(['at', 'every', 'cron', 'event', 'condition']);
export type TriggerType = z.infer<typeof TriggerTypeSchema>;
export const TriggerStatusSchema = z.enum(['draft', 'enabled', 'paused', 'error', 'archived']);

export const TriggerSchema = z.object({
  triggerId: z.string(),
  pluginId: z.string(),
  capabilityId: z.string(),
  type: TriggerTypeSchema,
  status: TriggerStatusSchema,
  version: z.number().int().min(1),
  config: z.record(z.string(), z.unknown()),
  arguments: z.record(z.string(), z.unknown()),
  condition: z.record(z.string(), z.unknown()).nullable(),
  nextFireAt: z.string().nullable(),
  lastFiredAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export type Trigger = z.infer<typeof TriggerSchema>;

export const TriggerListResponseSchema = z.object({
  items: z.array(TriggerSchema),
  nextCursor: z.string().nullable()
});

export type TriggerListResponse = z.infer<typeof TriggerListResponseSchema>;

export const TriggerFiringSchema = z.object({
  firingId: z.string(),
  triggerId: z.string(),
  sourceEventId: z.string().nullable().optional(),
  commandId: z.string().nullable().optional(),
  status: z.enum([
    'scheduled',
    'dispatching',
    'queued',
    'running',
    'awaiting_approval',
    'awaiting_user',
    'succeeded',
    'failed',
    'dead_letter',
    'cancelled'
  ]),
  attempt: z.number().int().min(1),
  error: z.record(z.string(), z.unknown()).nullable().optional(),
  scheduledFor: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export type TriggerFiring = z.infer<typeof TriggerFiringSchema>;

export const TriggerUpsertSchema = z.object({
  pluginId: z.string(),
  capabilityId: z.string(),
  type: TriggerTypeSchema,
  config: z.record(z.string(), z.unknown()),
  arguments: z.record(z.string(), z.unknown()).optional(),
  condition: z.record(z.string(), z.unknown()).nullable().optional()
});

export type TriggerUpsert = z.infer<typeof TriggerUpsertSchema>;

// ---------------------------------------------------------------------------
// Assistant / natural-language command domain
// ---------------------------------------------------------------------------

const OptionalWireStringSchema = z
  .string()
  .nullish()
  .transform((value) => value ?? undefined);

const OptionalWireNumberSchema = z
  .number()
  .nullish()
  .transform((value) => value ?? undefined);

export const AssistantSourceSchema = z
  .object({
    type: OptionalWireStringSchema,
    title: OptionalWireStringSchema,
    uri: OptionalWireStringSchema,
    abstract: OptionalWireStringSchema,
    snippet: OptionalWireStringSchema,
    score: OptionalWireNumberSchema,
    capabilityId: OptionalWireStringSchema
  })
  .passthrough();

export const AssistantActionSchema = z
  .object({
    id: z.string().optional(),
    kind: z.string().optional(),
    type: z.string().optional(),
    label: z.string(),
    params: z.record(z.string(), z.unknown()).optional()
  })
  .passthrough();

export const FixSuggestionSchema = z.object({
  action: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
  priority: z.number().int().min(1).default(1)
});

export type FixSuggestion = z.infer<typeof FixSuggestionSchema>;

export const AssistantResponseSchema = z.object({
  answer: z.string(),
  sources: z.array(AssistantSourceSchema),
  supplementalAnswers: z.array(
    z
      .object({
        kind: z.string(),
        title: z.string(),
        answer: z.string(),
        score: OptionalWireNumberSchema,
        sources: z.array(AssistantSourceSchema)
      })
      .passthrough()
  ),
  suggestedActions: z.array(AssistantActionSchema),
  fixSuggestions: z.array(FixSuggestionSchema).optional(),
  traceId: z.string(),
  artifacts: z
    .array(
      z
        .object({
          artifactId: z.string(),
          displayName: z.string(),
          mimeType: z.string().nullable().optional(),
          sizeBytes: z.number().nullable().optional(),
          artifactType: z.string().optional()
        })
        .passthrough()
    )
    .optional()
});

export type AssistantResponse = z.infer<typeof AssistantResponseSchema>;

export const ConversationSummarySchema = z.object({
  conversationId: z.string(),
  title: z.string(),
  conversationType: z.string(),
  status: z.string(),
  lastSequence: z.number().int(),
  lastMessageAt: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  metadata: z
    .object({
      knowledgeBaseIds: z.array(z.string()).max(10).optional()
    })
    .passthrough()
    .optional()
}).passthrough();

export const ConversationListSchema = z.object({
  items: z.array(ConversationSummarySchema),
  nextCursor: z.string().nullable()
});

export const ConversationMessageSchema = z.object({
  messageId: z.string(),
  conversationId: z.string(),
  sequenceNo: z.number().int(),
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  status: z.string(),
  content: z.object({
    schemaVersion: z.number().int(),
    blocks: z.array(
      z.object({
        type: z.string(),
        text: z.string().nullable().optional(),
        artifactId: z.string().nullable().optional()
      }).passthrough()
    )
  }).passthrough(),
  traceId: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).default({})
}).passthrough();

export const ConversationMessagePageSchema = z.object({
  conversationId: z.string(),
  messages: z.array(ConversationMessageSchema),
  nextAfterSequence: z.number().int().nullable(),
  hasMore: z.boolean()
});

export const ConversationArtifactSchema = z
  .object({
    artifactId: z.string(),
    artifactType: z.string(),
    displayName: z.string(),
    mimeType: z.string().nullable().optional(),
    sizeBytes: z.number().int().nullable().optional(),
    createdAt: z.string().nullable().optional()
  })
  .passthrough();

export const ConversationArtifactListSchema = z.object({
  artifacts: z.array(ConversationArtifactSchema)
});

export type ConversationArtifact = z.infer<typeof ConversationArtifactSchema>;

export const AssistantClientActionSchema = z.object({
  actionId: z.string().optional(),
  parentRunId: z.string().optional(),
  baseRevision: z.union([z.string(), z.number()]).optional(),
  expiresAt: z.union([z.string(), z.number()]).optional(),
  actionStatus: z.string().optional(),
  type: z.literal('browser_extract'),
  url: z.string().url(),
  focus: z.string().default('')
});

export type AssistantClientAction = z.infer<typeof AssistantClientActionSchema>;

// Capability failure fix suggestions: structured recovery actions emitted by
// the server when a tool call fails with a recoverable error (auth_error,
// rate_limited, timeout, etc.). Frontend renders these as one-click buttons
// in the conversation thread.
export const PersistentAssistantTurnSchema = z.object({
  conversationId: z.string(),
  userMessageId: z.string(),
  assistantMessageId: z.string(),
  runId: z.string(),
  traceId: z.string(),
  actionId: z.string().optional(),
  parentRunId: z.string().optional(),
  baseRevision: z.union([z.string(), z.number()]).optional(),
  expiresAt: z.union([z.string(), z.number()]).optional(),
  runStatus: z.string().optional(),
  status: z.string().optional(),
  actionStatus: z.string().optional(),
  answer: z.string(),
  generationMode: z.string(),
  evidenceStatus: z.string(),
  sources: z.array(AssistantSourceSchema),
  artifacts: z.array(z.record(z.string(), z.unknown())),
  clientActions: z.array(AssistantClientActionSchema).default([]),
  memoryStatus: z.string(),
  duplicate: z.boolean(),
  // 可选：当一次工具调用失败且能力返回了结构化 fix_suggestions 时，
  // 渲染端用 FixSuggestionButtons 渲染一键修复按钮。
  fixSuggestions: z.array(FixSuggestionSchema).default([])
});

export type ConversationSummary = z.infer<typeof ConversationSummarySchema>;
export type ConversationMessage = z.infer<typeof ConversationMessageSchema>;
// Capability failure fix suggestions: structured recovery actions emitted by
// the server when a tool call fails with a recoverable error (auth_error,
// rate_limited, timeout, etc.). Frontend renders these as one-click buttons
// in the conversation thread.
// (FixSuggestionSchema / FixSuggestion type live above so that
// PersistentAssistantTurnSchema can reference them.)

export type PersistentAssistantTurn = z.infer<typeof PersistentAssistantTurnSchema>;

// Capability failure fix suggestions: structured recovery actions emitted by
// the server when a tool call fails with a recoverable error (auth_error,
// rate_limited, timeout, etc.). Frontend renders these as one-click buttons
// in the conversation thread.
//
// Declared early so PersistentAssistantTurnSchema below can reference it.
export const AssistantStreamInputSchema = z
  .object({
    requestId: z.string().min(1).max(160),
    conversationId: z.string().min(1).max(128),
    message: z.string().min(1).max(10_000),
    clientMessageId: z.string().min(1).max(160),
    attachmentIds: z.array(z.string().min(1).max(256)).max(20).default([]),
    knowledgeBaseIds: z.array(z.string().min(1)).max(10).optional(),
    // 三态：true=显式开启，false=显式关闭（禁止服务端自动路由），null=未表态。
    deepMode: z.boolean().nullable().default(null)
  })
  .strict();

export const SkillInstallProposalSchema = z.object({
  proposalId: z.string(),
  uploadId: z.string().optional(),
  action: z.string().optional(),
  skillRef: z.string(),
  slug: z.string(),
  displayName: z.string(),
  summary: z.string(),
  version: z.string(),
  registry: z.string(),
  status: z.string(),
  verification: z.string().optional(),
  warnings: z.array(z.string()).optional(),
  manifest: z.record(z.string(), z.unknown()).optional(),
  expiresAt: z.number()
});

export type SkillInstallProposal = z.infer<typeof SkillInstallProposalSchema>;

export const SkillBundleInspectionSchema = z.object({
  uploadId: z.string(),
  bundleFilename: z.string(),
  archiveSha256: z.string(),
  status: z.string(),
  bundleType: z.enum(['prompt_skill', 'cli_source']).optional(),
  cli: z.record(z.string(), z.unknown()).optional(),
  cliPackage: z.record(z.string(), z.unknown()).optional(),
  expiresAt: z.number(),
  warnings: z.array(z.string()).optional(),
  candidates: z.array(
    z.object({
      slug: z.string(),
      rootPath: z.string(),
      description: z.string(),
      contentSha256: z.string(),
      warnings: z.array(z.string()).optional(),
      selectable: z.boolean()
    }).passthrough()
  )
});

export type SkillBundleInspection = z.infer<typeof SkillBundleInspectionSchema>;

export const SkillWorkshopProposalSchema = z.object({
  proposalId: z.string(),
  name: z.string(),
  description: z.string(),
  status: z.string(),
  bundleSha256: z.string(),
  supportFileCount: z.number().int().nonnegative(),
  bodySizeBytes: z.number().int().nonnegative(),
  expiresAt: z.number()
});

export type SkillWorkshopProposal = z.infer<typeof SkillWorkshopProposalSchema>;

export const AssistantStreamEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('accepted'),
    clientMessageId: z.string(),
    runId: z.string()
  }),
  z.object({
    type: z.literal('status'),
    message: z.string(),
    phase: z.string().optional(),
    turn: z.number().int().nonnegative().optional(),
    capabilityId: z.string().optional()
  }),
  z.object({
    type: z.literal('deep_research_plan'),
    iteration: z.number().int().nonnegative(),
    subQuestions: z.array(
      z.object({
        id: z.string(),
        question: z.string(),
        intent: z.string()
      }).passthrough()
    )
  }),
  z.object({
    type: z.literal('deep_research_iteration_started'),
    iteration: z.number().int().nonnegative(),
    coveredSubQuestions: z.array(z.string())
  }),
  z.object({
    type: z.literal('deep_research_reflection'),
    iteration: z.number().int().nonnegative(),
    coveredSubQuestionIds: z.array(z.string()),
    missingTopics: z.array(z.string()),
    confidence: z.number().min(0).max(1),
    rationale: z.string()
  }),
  z.object({
    type: z.literal('deep_research_synthesize_completed'),
    iteration: z.number().int().nonnegative(),
    answerChars: z.number().int().nonnegative()
  }),
  z.object({
    type: z.literal('candidate_start'),
    candidateId: z.string(),
    turn: z.number().int().nonnegative()
  }),
  z.object({
    type: z.literal('delta'),
    index: z.number().int().nonnegative(),
    delta: z.string(),
    candidateId: z.string().optional(),
    turn: z.number().int().nonnegative().optional(),
    synthetic: z.boolean().optional()
  }),
  z.object({
    type: z.literal('discard'),
    candidateId: z.string(),
    turn: z.number().int().nonnegative(),
    reason: z.string()
  }),
  z.object({
    type: z.literal('commit'),
    candidateId: z.string(),
    turn: z.number().int().nonnegative(),
    text: z.string()
  }),
  z.object({
    type: z.literal('skill_install_proposal'),
    turn: z.number().int().nonnegative(),
    proposal: SkillInstallProposalSchema
  }),
  z.object({
    type: z.literal('skill_install_proposals'),
    turn: z.number().int().nonnegative(),
    proposals: z.array(SkillInstallProposalSchema)
  }),
  z.object({
    type: z.literal('skill_bundle_inspection'),
    turn: z.number().int().nonnegative(),
    bundle: SkillBundleInspectionSchema
  }),
  z.object({
    type: z.literal('cli_bundle_inspection'),
    turn: z.number().int().nonnegative(),
    bundle: SkillBundleInspectionSchema
  }),
  z.object({
    type: z.literal('skill_workshop_proposal'),
    turn: z.number().int().nonnegative(),
    proposal: SkillWorkshopProposalSchema
  }),
  z.object({
    type: z.literal('replace'),
    candidateId: z.string().nullable().optional(),
    text: z.string(),
    reason: z.string()
  }),
  z.object({
    type: z.literal('completed'),
    turn: PersistentAssistantTurnSchema
  }),
  z.object({
    type: z.literal('error'),
    error: z.object({
      code: z.string(),
      message: z.string(),
      // goal_contract 失败时服务端携带的阶段性结果原文（终局不覆盖原则），
      // 渲染端在失败卡片中以 Markdown 展示。
      answer: OptionalWireStringSchema
    })
  })
]);

export type AssistantStreamInput = z.infer<typeof AssistantStreamInputSchema>;
export type AssistantStreamEvent = z.infer<typeof AssistantStreamEventSchema>;

export const CommandStepSchema = z
  .object({
    stepId: z.string().optional(),
    name: z.string().optional(),
    label: z.string().optional(),
    capabilityId: z.string().optional(),
    pluginId: z.string().optional(),
    agent: z.string().optional(),
    status: z.string().optional(),
    dependsOn: z.array(z.string()).optional()
  })
  .passthrough();

export const CommandActionSchema = z
  .object({
    actionId: z.string(),
    actionType: z.string(),
    label: z.string().optional(),
    status: z.string().optional(),
    details: z.unknown().optional()
  })
  .passthrough();

export const CommandSchema = z
  .object({
    commandId: z.string(),
    status: z.string(),
    version: z.number().int().min(1),
    originalMessage: z.string().optional(),
    intent: z.record(z.string(), z.unknown()).default({}),
    steps: z.array(CommandStepSchema),
    policy: z
      .object({
        allowed: z.boolean().default(true),
        allowedRoles: z.array(z.string()).default([]),
        blockers: z.array(z.string()).default([]),
        requiresDownstreamApproval: z.boolean().optional()
      })
      .passthrough(),
    execution: z
      .object({
        nextActions: z.array(CommandActionSchema).default([]),
        stepResults: z.array(z.record(z.string(), z.unknown())).default([])
      })
      .passthrough(),
    traceId: z.string(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional()
  })
  .passthrough();

export type Command = z.infer<typeof CommandSchema>;

export const CommandResponseSchema = z.object({
  kind: z.literal('command'),
  message: z.string(),
  command: CommandSchema
});

export const CommandQuestionResponseSchema = z
  .object({
    kind: z.literal('question'),
    message: z.string(),
    traceId: z.string()
  })
  .passthrough();

export const CommandPreviewResponseSchema = z.discriminatedUnion('kind', [
  CommandResponseSchema,
  CommandQuestionResponseSchema
]);

export type CommandResponse = z.infer<typeof CommandResponseSchema>;
export type CommandPreviewResponse = z.infer<typeof CommandPreviewResponseSchema>;

// ---------------------------------------------------------------------------
// Embedded browser domain
// ---------------------------------------------------------------------------

export const BrowserBoundsSchema = z
  .object({
    x: z.number().int().min(0).max(10_000),
    y: z.number().int().min(0).max(10_000),
    width: z.number().int().min(0).max(10_000),
    height: z.number().int().min(0).max(10_000)
  })
  .strict();

export type BrowserBounds = z.infer<typeof BrowserBoundsSchema>;

export const BrowserNavigateInputSchema = z
  .object({
    url: z
      .string()
      .min(1)
      .max(2_048)
      .url()
      .refine((value) => {
        const protocol = new URL(value).protocol;
        return protocol === 'http:' || protocol === 'https:';
      }, 'browser URL must use http or https')
  })
  .strict();

export type BrowserNavigateInput = z.infer<typeof BrowserNavigateInputSchema>;

export const BrowserArtifactInputSchema = z
  .object({
    artifactId: z.string().min(1).max(256),
    displayName: z.string().min(1).max(255)
  })
  .strict();

export type BrowserArtifactInput = z.infer<typeof BrowserArtifactInputSchema>;

export const BrowserActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('navigate'),
    url: BrowserNavigateInputSchema.shape.url
  }),
  z.object({
    type: z.literal('click'),
    targetText: z.string().trim().min(1).max(200)
  }),
  z.object({
    type: z.literal('type'),
    targetText: z.string().trim().max(200).optional(),
    value: z.string().max(4_000),
    submit: z.boolean().optional()
  }),
  z.object({
    type: z.literal('scroll'),
    direction: z.enum(['up', 'down'])
  }),
  z.object({
    type: z.literal('extract')
  }),
  z.object({ type: z.literal('back') }),
  z.object({ type: z.literal('forward') }),
  z.object({ type: z.literal('reload') }),
  z.object({ type: z.literal('stop') })
]);

export type BrowserAction = z.infer<typeof BrowserActionSchema>;

export const BrowserStateSchema = z.object({
  available: z.boolean(),
  mode: z.enum(['native', 'preview']),
  visible: z.boolean(),
  url: z.string(),
  title: z.string(),
  isLoading: z.boolean(),
  canGoBack: z.boolean(),
  canGoForward: z.boolean(),
  lastError: z.string().nullable(),
  artifactId: z.string().nullable().default(null),
  artifactDisplayName: z.string().nullable().default(null)
});

export type BrowserState = z.infer<typeof BrowserStateSchema>;

export const BrowserActionResultSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  state: BrowserStateSchema,
  extractedText: z.string().optional()
});

export type BrowserActionResult = z.infer<typeof BrowserActionResultSchema>;

// ---------------------------------------------------------------------------
// Knowledge domain
// ---------------------------------------------------------------------------

export const KnowledgeBaseSchema = z.object({
  knowledgeBaseId: z.string(),
  tenantId: z.string(),
  name: z.string(),
  description: z.string(),
  domain: z.string(),
  routingKeywords: z.array(z.string()),
  isDefault: z.boolean(),
  enabled: z.boolean(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const KnowledgeDocumentSchema = z.object({
  docId: z.string(),
  tenantId: z.string(),
  knowledgeBaseId: z.string().default('default'),
  knowledgeBaseName: z.string().default('默认知识库'),
  domain: z.string().default('general'),
  title: z.string(),
  uri: z.string(),
  chunkCount: z.number().int().min(0),
  charCount: z.number().int().min(0),
  mimeType: z.string().default('text/plain'),
  parser: z.string().default('legacy'),
  indexingStatus: z.enum(['waiting', 'parsing', 'splitting', 'indexing', 'completed', 'error']).default('completed'),
  indexingError: z.string().default(''),
  byteSize: z.number().int().min(0).default(0),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const KnowledgeDocumentPickerInputSchema = z.object({
  knowledgeBaseId: z.string().min(1).max(64)
}).strict();

export const KnowledgeDocumentPickerResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), document: KnowledgeDocumentSchema }),
  z.object({
    ok: z.literal(false),
    cancelled: z.boolean().optional(),
    error: z.string().optional()
  })
]);

export const KnowledgeHitSchema = z.object({
  chunkId: z.string(),
  docId: z.string(),
  knowledgeBaseId: z.string().default('default'),
  knowledgeBaseName: z.string().default('默认知识库'),
  domain: z.string().default('general'),
  title: z.string(),
  uri: z.string(),
  snippet: z.string(),
  score: z.number()
});

export const KnowledgeRouteSchema = z.object({
  mode: z.enum(['explicit', 'domain', 'automatic', 'default', 'external']),
  knowledgeBaseIds: z.array(z.string()),
  domains: z.array(z.string()),
  knowledgeBases: z.array(
    z.object({
      knowledgeBaseId: z.string(),
      name: z.string(),
      domain: z.string()
    })
  ).default([])
});

export const KnowledgeSearchResultSchema = z.object({
  query: z.string(),
  route: KnowledgeRouteSchema,
  hits: z.array(KnowledgeHitSchema)
});

export type KnowledgeBase = z.infer<typeof KnowledgeBaseSchema>;
export type KnowledgeDocument = z.infer<typeof KnowledgeDocumentSchema>;
export type KnowledgeDocumentPickerInput = z.infer<typeof KnowledgeDocumentPickerInputSchema>;
export type KnowledgeDocumentPickerResult = z.infer<typeof KnowledgeDocumentPickerResultSchema>;
export type KnowledgeHit = z.infer<typeof KnowledgeHitSchema>;
export type KnowledgeRoute = z.infer<typeof KnowledgeRouteSchema>;
export type KnowledgeSearchResult = z.infer<typeof KnowledgeSearchResultSchema>;

// ---------------------------------------------------------------------------
// Telesales pilot workspace
// ---------------------------------------------------------------------------

export const TelesalesMerchantSchema = z.object({
  merchantId: z.string(),
  name: z.string(),
  category: z.string(),
  region: z.string(),
  phone: z.string(),
  assignedSalespersonId: z.string().nullable(),
  tier: z.string(),
  lifecycleStage: z.string(),
  version: z.number().int().min(1)
});

export const TelesalesFollowupSchema = z.object({
  followupId: z.string(),
  merchantId: z.string(),
  sourceCallId: z.string().nullable(),
  salespersonId: z.string(),
  priority: z.string(),
  scheduledAt: z.string(),
  recommendedAction: z.string(),
  status: z.string()
});

export const TelesalesInspectionSchema = z.object({
  inspectionId: z.string(),
  callId: z.string(),
  complianceScore: z.number(),
  salesQualityScore: z.number(),
  riskLevel: z.string(),
  violations: z.array(z.record(z.string(), z.unknown())),
  inspectedAt: z.string()
});

export const TelesalesCampaignSchema = z.object({
  campaignId: z.string(),
  name: z.string(),
  status: z.string(),
  audienceCount: z.number().int().min(0),
  excludedCount: z.number().int().min(0),
  scheduleWindow: z.string(),
  scriptVersion: z.string(),
  metrics: z.record(z.string(), z.unknown()),
  precheck: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      passed: z.boolean()
    })
  ),
  version: z.number().int().min(1),
  updatedAt: z.string()
});

export const TelesalesWorkspaceSchema = z.object({
  plan: z
    .object({
      planId: z.string(),
      planDate: z.string(),
      targetGmv: z.number(),
      targetConversions: z.number().int().min(0),
      targetOutboundCalls: z.number().int().min(0),
      humanCallsAllocated: z.number().int().min(0),
      aiCallsAllocated: z.number().int().min(0),
      status: z.string()
    })
    .nullable(),
  conversionFunnel: z.object({
    called: z.number().int().min(0),
    connected: z.number().int().min(0),
    intent: z.number().int().min(0),
    aiCalls: z.number().int().min(0),
    humanCalls: z.number().int().min(0),
    followup: z.number().int().min(0)
  }),
  qualitySummary: z.object({
    totalInspections: z.number().int().min(0),
    avgComplianceScore: z.number(),
    avgQualityScore: z.number(),
    highRiskCount: z.number().int().min(0)
  }),
  callTargetCompletion: z.number(),
  adjustmentSuggestions: z.array(z.string()),
  merchants: z.array(TelesalesMerchantSchema),
  followups: z.array(TelesalesFollowupSchema),
  inspections: z.array(TelesalesInspectionSchema),
  campaigns: z.array(TelesalesCampaignSchema),
  governance: z.object({
    pendingApprovals: z.number().int().min(0),
    queuedExternalEffects: z.number().int().min(0),
    completedCampaigns: z.number().int().min(0)
  })
});

export type TelesalesWorkspace = z.infer<typeof TelesalesWorkspaceSchema>;

// ---------------------------------------------------------------------------
// Verification artifacts
// ---------------------------------------------------------------------------

export const VerificationOpenResultSchema = z.object({
  url: z.string().url(),
  expiresAt: z.string(),
  traceId: z.string()
});

export type VerificationOpenResult = z.infer<typeof VerificationOpenResultSchema>;

export const ArtifactPickerInputSchema = z.object({
  conversationId: z.string().min(1).max(128)
}).strict();

export const ClipboardImageInputSchema = z.object({
  conversationId: z.string().min(1).max(128),
  filename: z.string().min(1).max(128),
  mimeType: z.string().regex(/^image\/[a-z0-9.+-]+$/i).max(100),
  contentBase64: z.string().min(1).max(20_000_000)
}).strict();

export const ArtifactPickerResultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    artifact: z.object({
      artifactId: z.string(),
      displayName: z.string(),
      mimeType: z.string().nullable().optional(),
      sizeBytes: z.number().int().nullable().optional(),
      sha256: z.string().nullable().optional()
    }).passthrough()
  }),
  z.object({
    ok: z.literal(false),
    cancelled: z.boolean().optional(),
    error: z.string().optional()
  })
]);

export type ArtifactPickerResult = z.infer<typeof ArtifactPickerResultSchema>;

// ---------------------------------------------------------------------------
// Client update check (方案 A：轻量版本检查 + 浏览器下载安装)
// ---------------------------------------------------------------------------

export const AppUpdateStateSchema = z.object({
  status: z.enum(['idle', 'checking', 'up-to-date', 'available', 'error']),
  currentVersion: z.string(),
  latestVersion: z.string().optional(),
  notes: z.string().optional(),
  downloadUrl: z.string().optional(),
  checkedAt: z.string().optional(),
  error: z.string().optional()
});

export type AppUpdateState = z.infer<typeof AppUpdateStateSchema>;

// ---------------------------------------------------------------------------
// Channel names used by the IPC bridge
// ---------------------------------------------------------------------------

export const IpcChannels = {
  Request: 'workbench:request',
  StartAssistantStream: 'workbench:assistant-stream:start',
  CancelAssistantStream: 'workbench:assistant-stream:cancel',
  SubscribeAnomalies: 'workbench:subscribe-anomalies',
  UnsubscribeAnomalies: 'workbench:unsubscribe-anomalies',
  OpenVerificationArtifact: 'workbench:open-verification-artifact',
  GetSession: 'workbench:get-session',
  UpdateSession: 'workbench:update-session',
  AuthenticateSession: 'workbench:authenticate-session',
  LogoutSession: 'workbench:logout-session',
  SendEmailVerificationCode: 'workbench:send-email-verification-code',
  SelectAndUploadArtifact: 'workbench:select-and-upload-artifact',
  SelectAndUploadKnowledgeDocument: 'workbench:select-and-upload-knowledge-document',
  UploadClipboardImage: 'workbench:upload-clipboard-image',
  BrowserGetState: 'workbench:browser:get-state',
  BrowserSetVisible: 'workbench:browser:set-visible',
  BrowserSetBounds: 'workbench:browser:set-bounds',
  BrowserNavigate: 'workbench:browser:navigate',
  BrowserOpenArtifact: 'workbench:browser:open-artifact',
  BrowserAction: 'workbench:browser:action',
  SubscribeBrowserState: 'workbench:browser:subscribe-state',
  UnsubscribeBrowserState: 'workbench:browser:unsubscribe-state',
  // main -> renderer fan-out (one channel per logical stream)
  AssistantStreamEvent: 'workbench:assistant-stream:event',
  AnomalyEvent: 'workbench:anomaly-event',
  BrowserStateEvent: 'workbench:browser:state',
  AppUpdateStateEvent: 'workbench:update:state',
  // 客户端更新检查（方案 A：轻量版本检查 + 浏览器下载安装）
  GetAppUpdateState: 'workbench:update:get-state',
  CheckAppUpdate: 'workbench:update:check',
  OpenAppUpdateDownload: 'workbench:update:open-download',
  // 下载/打开本地文件
  OpenArtifactFile: 'workbench:open-artifact-file',
  DownloadArtifact: 'workbench:download-artifact',
  ExportArtifactPptx: 'workbench:export-artifact-pptx',
  // 获取本地预览 URL（用于 iframe 嵌入 Microsoft Office Viewer）
  GetArtifactPreviewUrl: 'workbench:get-artifact-preview-url',
  // 把 Office 文档转成 PDF（用于内嵌预览）
  ConvertArtifactToPdf: 'workbench:convert-artifact-pdf',
  // 读取本地 PDF 文件（用 file:// 在 iframe 中加载）
  ReadLocalPdf: 'workbench:read-local-pdf',
  // 读取当前租户下的图片等小型 artifact 内容（用于安全 blob 预览）
  ReadArtifactContent: 'workbench:read-artifact-content',
  // 在系统默认浏览器里打开 URL（让浏览器面板里的内容跳出到原生浏览器）
  OpenExternalUrl: 'workbench:open-external-url'
} as const;

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels];

// ---------------------------------------------------------------------------
// workbenchApi surface contract (used by preload-contract.test.ts)
// ---------------------------------------------------------------------------

export const WORKBENCH_API_KEYS = [
  'request',
  'streamAssistant',
  'subscribeAnomalies',
  'openVerificationArtifact',
  'getSession',
  'updateSession',
  'authenticateSession',
  'logoutSession',
  'sendEmailVerificationCode',
  'selectAndUploadArtifact',
  'selectAndUploadKnowledgeDocument',
  'uploadClipboardImage',
  'browserGetState',
  'browserSetVisible',
  'browserSetBounds',
  'browserNavigate',
  'browserOpenArtifact',
  'browserAction',
  'subscribeBrowserState',
  'openArtifactFile',
  'downloadArtifactFile',
  'exportArtifactToPptx',
  'convertArtifactToPdf',
  'readLocalPdf',
  'readArtifactContent',
  'getAppUpdateState',
  'checkAppUpdate',
  'openAppUpdateDownload',
  'subscribeAppUpdateState',
  'openExternalUrl',
  'requestArtifactPreviewToken'
] as const;

export type WorkbenchApiKey = (typeof WORKBENCH_API_KEYS)[number];

export const FORBIDDEN_WINDOW_KEYS = [
  'ipcRenderer',
  'require',
  'process',
  'global',
  'Buffer',
  'module',
  '__dirname',
  '__filename'
] as const;
