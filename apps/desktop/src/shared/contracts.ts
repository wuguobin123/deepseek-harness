/**
 * dsh RPC wire contracts for the Electron desktop client.
 *
 * Two layers:
 * - Wire envelope: client-request / server-response / client-response / server-request
 *   (from `@deepseek-ai/dsh-host-apiproxy`'s `rpc.schema.ts`). The desktop client speaks
 *   the same envelope as the web frontend.
 * - Event stream frame unions: MuxFrame (per-session pushes + answerable
 *   approval/question server-requests) and HostFrame (host-wide info).
 *
 * Renderer-facing helper surface (WORKBENCH_API_KEYS) is the IPC bridge keys exposed
 * by the preload; the main process fans them onto the wire envelope.
 */
import { z } from 'zod'

// ---------------------------------------------------------------------------
// RPC wire envelope
// ---------------------------------------------------------------------------

/** Opaque server-issued correlation id (echoed back on response). */
export const RpcIdSchema = z.string().min(1)

/** Discriminated by `code`; details is required (per-branch typed). */
export const RpcErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.unknown()).default({}),
})

export type RpcError = z.infer<typeof RpcErrorSchema>

/** Business success / failure union. */
export const RpcResultSchema = <T extends z.ZodTypeAny>(value: T) =>
  z.union([
    z.object({ ok: z.literal(true), value }),
    z.object({ ok: z.literal(false), error: RpcErrorSchema }),
  ])

/** Outbound client → server request. */
export const ClientRequestSchema = z.object({
  type: z.literal('client-request'),
  rpcId: RpcIdSchema,
  method: z.string(),
  payload: z.unknown(),
})

/** Inbound server → client response. */
export const ServerResponseSchema = z.object({
  type: z.literal('server-response'),
  rpcId: RpcIdSchema,
  result: z.union([
    z.object({ ok: z.literal(true), value: z.unknown().optional() }),
    z.object({ ok: z.literal(false), error: RpcErrorSchema }),
  ]),
})

/** Outbound client → server response (answer to a server-request frame). */
export const ClientResponseSchema = z.object({
  type: z.literal('client-response'),
  rpcId: RpcIdSchema,
  result: z.union([
    z.object({ ok: z.literal(true), value: z.unknown().optional() }),
    z.object({ ok: z.literal(false), error: RpcErrorSchema }),
  ]),
})

export type ClientRequest = z.infer<typeof ClientRequestSchema>
export type ServerResponse = z.infer<typeof ServerResponseSchema>
export type ClientResponse = z.infer<typeof ClientResponseSchema>

// ---------------------------------------------------------------------------
// Stream frames (Mux + Host)
// ---------------------------------------------------------------------------

/** A server-request frame is the wire form a stream pushes; payload = frame. */
export const ServerRequestSchema = z.object({
  type: z.literal('server-request'),
  rpcId: RpcIdSchema,
  method: z.string(),
  payload: z.unknown(),
})

/**
 * MuxFrame: per-session pushes. Answerable server-requests (approval/question
 * requested) echo `rpcId` so the renderer can POST `/api/respond` back.
 */
export const SessionEventSchema = z.object({
  type: z.string(),
  sessionId: z.string(),
  payload: z.unknown(),
})

export const MuxFrameSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('session/event'), sessionId: z.string(), event: z.unknown() }),
  z.object({ type: z.literal('session/subscribed'), sessionId: z.string(), lastSeq: z.number() }),
  z.object({ type: z.literal('session/projection'), sessionId: z.string(), key: z.string(), value: z.unknown(), seq: z.number() }),
  z.object({ type: z.literal('session/queue'), sessionId: z.string(), items: z.array(z.unknown()) }),
  z.object({ type: z.literal('session/jobs'), sessionId: z.string(), jobs: z.array(z.unknown()) }),
  z.object({
    type: z.literal('approval/requested'),
    sessionId: z.string(),
    approvalId: z.string(),
    toolName: z.string(),
    callId: z.string().optional(),
    reason: z.string().optional(),
  }),
  z.object({
    type: z.literal('approval/resolved'),
    sessionId: z.string(),
    approvalId: z.string(),
    outcome: z.string(),
  }),
  z.object({
    type: z.literal('question/requested'),
    sessionId: z.string(),
    questions: z.array(z.unknown()),
  }),
  z.object({
    type: z.literal('question/resolved'),
    sessionId: z.string(),
    questionRpcId: z.string(),
    outcome: z.string(),
  }),
  z.object({ type: z.literal('stream/error'), error: RpcErrorSchema }),
])

export type MuxFrame = z.infer<typeof MuxFrameSchema>

export const HostFrameSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('host/session-added'),
    sessionId: z.string(),
    blank: z.boolean(),
    parentSessionId: z.string().optional(),
    origin: z.string().optional(),
    cwd: z.string().optional(),
    agentPreset: z.string().optional(),
  }),
  z.object({ type: z.literal('host/session-removed'), sessionId: z.string() }),
  z.object({ type: z.literal('host/session-status'), sessionId: z.string(), running: z.boolean() }),
  z.object({ type: z.literal('host/agent-error'), sessionId: z.string(), message: z.string() }),
  z.object({ type: z.literal('host/workspace-changed'), workspace: z.unknown() }),
  z.object({ type: z.literal('host/workspace-removed'), workspaceId: z.string() }),
  z.object({ type: z.literal('host/workspace-order-changed'), workspaceIds: z.array(z.string()) }),
  z.object({ type: z.literal('host/archived-sessions-changed'), archivedSessionIds: z.array(z.string()) }),
  z.object({ type: z.literal('host/remote-event'), event: z.string(), args: z.array(z.unknown()) }),
  z.object({ type: z.literal('stream/error'), error: RpcErrorSchema }),
])

export type HostFrame = z.infer<typeof HostFrameSchema>

// ---------------------------------------------------------------------------
// Persisted renderer-facing settings (just baseUrl now; credential-store is the source of truth)
// ---------------------------------------------------------------------------

export const SessionStateSchema = z.object({
  baseUrl: z.string(),
  version: z.string().default('2'),
})

export type SessionState = z.infer<typeof SessionStateSchema>

// ---------------------------------------------------------------------------
// Auth state + account wire-method inputs
// ---------------------------------------------------------------------------

/**
 * Renderer-facing view of the current bearer session.
 *
 * `signedIn: false` carries no other fields — the cold-start gate reads the
 * `signedIn` discriminant first and renders SignInCard without consulting
 * the rest. Persisted via `credential-store` v3 and broadcast over
 * `IpcChannels.AuthStateEvent` whenever it changes.
 */
export const AuthStateSchema = z.discriminatedUnion('signedIn', [
  z.object({
    signedIn: z.literal(false),
  }),
  z.object({
    signedIn: z.literal(true),
    userId: z.string().min(1),
    displayName: z.string().nullable(),
    /** Absolute unix-millisecond expiry of the session this view came from. */
    expiresAt: z.number().int().positive(),
  }),
])

export type AuthState = z.infer<typeof AuthStateSchema>

/** account.signin / account.signup request shape (shared by sign-in / sign-up forms). */
export const SignInInputSchema = z.object({
  email: z.string().min(1).max(254),
  password: z.string().min(1).max(1024),
})

export type SignInInput = z.infer<typeof SignInInputSchema>

/** account.signup extra fields on top of SignInInput. */
export const SignUpInputSchema = SignInInputSchema.extend({
  displayName: z.string().max(254).optional(),
  /**
   * Six-digit verification code produced by a prior `account.emailCode` call.
   * The backend rejects signup without it when email-verification is enabled.
   */
  verificationCode: z.string().regex(/^\d{6}$/).optional(),
})

export type SignUpInput = z.infer<typeof SignUpInputSchema>

/** account.emailCode request shape. */
export const RequestEmailCodeInputSchema = z.object({
  email: z.string().min(1).max(254),
})

export type RequestEmailCodeInput = z.infer<typeof RequestEmailCodeInputSchema>

/** account.emailCode response shape. */
export const RequestEmailCodeValueSchema = z.object({
  expiresInSeconds: z.number().int().positive(),
  retryAfterSeconds: z.number().int().nonnegative(),
})

export type RequestEmailCodeValue = z.infer<typeof RequestEmailCodeValueSchema>

// ---------------------------------------------------------------------------
// Client update check (stub: always up-to-date until dsh-ops exposes a releases endpoint)
// ---------------------------------------------------------------------------

export const AppUpdateStateSchema = z.object({
  status: z.enum(['idle', 'checking', 'up-to-date', 'available', 'error']),
  currentVersion: z.string(),
  latestVersion: z.string().optional(),
  notes: z.string().optional(),
  downloadUrl: z.string().optional(),
  checkedAt: z.string().optional(),
  error: z.string().optional(),
})

export type AppUpdateState = z.infer<typeof AppUpdateStateSchema>

// ---------------------------------------------------------------------------
// IPC channels (main ↔ renderer)
// ---------------------------------------------------------------------------

export const IpcChannels = {
  /** Generic RPC bridge: invoke(method, payload) → ServerResponse. */
  Request: 'workbench:request',
  /** Open the SSE carrier GET /api/events.mux and fan frames as MuxEvent. */
  SubscribeMux: 'workbench:subscribe-mux',
  UnsubscribeMux: 'workbench:unsubscribe-mux',
  /** Open the SSE carrier GET /api/events.host and fan frames as HostEvent. */
  SubscribeHost: 'workbench:subscribe-host',
  UnsubscribeHost: 'workbench:unsubscribe-host',
  /** POST /api/respond (ClientResponse envelope) for answerable server-requests. */
  Respond: 'workbench:respond',
  /** Settings persistence. */
  GetSession: 'workbench:get-session',
  UpdateSession: 'workbench:update-session',
  // main -> renderer fan-out
  MuxEvent: 'workbench:mux:event',
  HostEvent: 'workbench:host:event',
  // update stub
  AppUpdateStateEvent: 'workbench:update:state',
  GetAppUpdateState: 'workbench:update:get-state',
  CheckAppUpdate: 'workbench:update:check',
  OpenAppUpdateDownload: 'workbench:update:open-download',
  // auth: bearer session lifecycle (workbuddy multi-user surface)
  GetAuthState: 'workbench:auth:get-state',
  RequestEmailCode: 'workbench:auth:request-email-code',
  SignUp: 'workbench:auth:sign-up',
  SignIn: 'workbench:auth:sign-in',
  SignOut: 'workbench:auth:sign-out',
  AuthStateEvent: 'workbench:auth:state',
} as const

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels]

// ---------------------------------------------------------------------------
// workbenchApi surface (preload exposes exactly these keys on window.workbenchApi)
// ---------------------------------------------------------------------------

export const WORKBENCH_API_KEYS = [
  'request',
  'subscribeMux',
  'subscribeHost',
  'respond',
  'getSession',
  'updateSession',
  'getAppUpdateState',
  'checkAppUpdate',
  'openAppUpdateDownload',
  'subscribeAppUpdateState',
  'getAuthState',
  'requestEmailCode',
  'signUp',
  'signIn',
  'signOut',
  'subscribeAuthState',
] as const

export type WorkbenchApiKey = (typeof WORKBENCH_API_KEYS)[number]

export const FORBIDDEN_WINDOW_KEYS = [
  'ipcRenderer',
  'require',
  'process',
  'global',
  'Buffer',
  'module',
  '__dirname',
  '__filename',
] as const
