/**
 * Renderer-side API wrapper.
 *
 * Thin typed wrappers over `window.workbenchApi.request(method, payload)` —
 * each helper builds the right envelope and forwards to the IPC bridge. The
 * bridge in turn POSTs `${baseUrl}/api/<method>` with a ClientRequest envelope.
 *
 * Response shapes mirror `packages/host/apiproxy/src/api/*.schema.ts`. Every
 * list-style method returns its items under a named envelope (`items`,
 * `skills`, `presets`, `providers`) — never a bare array — and the consumer
 * pages must read through the envelope.
 *
 * Subscription helpers (`subscribeMux`, `subscribeHost`, `respond`) re-export
 * the matching bridge keys so feature pages don't reach past `api.ts`.
 */
import type {
  AppUpdateState,
  AuthState,
  HostFrame,
  MuxFrame,
  RequestEmailCodeValue,
  SessionState,
} from '../shared/contracts'
import type { WorkbenchApi } from '../preload/index'

declare global {
  interface Window {
    workbenchApi: WorkbenchApi & { setBaseUrl?: (url: string) => void }
    __WORKBENCH_API_OVERRIDE__?: WorkbenchApi
  }
}

function bridge(): WorkbenchApi {
  return window.__WORKBENCH_API_OVERRIDE__ ?? window.workbenchApi
}

type RpcOk<T> = { ok: true; value: T }
type RpcErr = { ok: false; error: { code: string; message: string } }
type RpcResult<T> = RpcOk<T> | RpcErr

async function call<T = unknown>(method: string, payload: unknown): Promise<T> {
  const result = (await bridge().request(method, payload)) as RpcResult<T>
  if (result.ok) return result.value
  throw Object.assign(new Error(result.error.message), { code: result.error.code })
}

// ----- Host -----

/**
 * Mirrors `host.describe` (`packages/host/apiproxy/src/api/host.schema.ts:14`).
 * The backend only reports its own identity and what the running agent is
 * currently bound to — there is no `name`/`platform`/`capabilities` here. Use
 * `session.models` to enumerate the configurable provider list.
 */
export interface HostDescribe {
  version: string
  cwd: string
  provider?: string
  model?: string
  attachedSessions: number
  home: string
  canOpenPath: boolean
}

export const host = {
  describe: () => call<HostDescribe>('host.describe', {}),
}

// ----- Sessions -----

/**
 * One row of `session.list`. The server does not store a top-level `title`;
 * it ships the projection baseline on the same row so the client can read
 * `projections.values.title` (string | undefined) when one has been computed.
 * `updatedAt` is a Unix epoch millis number, not an ISO string.
 */
export interface SessionListItem {
  sessionId: string
  updatedAt: number
  running: boolean
  blank: boolean
  parentSessionId?: string
  origin?: 'subagent'
  cwd?: string
  agentPreset?: string
  projections?: {
    asOfSeq: number
    values: Record<string, unknown>
  }
}

/**
 * One row of `session.search`. The server only ships `sessionId` + a
 * pre-computed text snippet — titles and timestamps belong to `session.list`.
 */
export interface SessionSearchItem {
  sessionId: string
  snippet: string
}

export const session = {
  list: (input: { workspaceId?: string } = {}) =>
    call<{ items: SessionListItem[] }>('session.list', input),
  create: (input: { workspaceId?: string; cwd?: string; sessionId?: string; agentPreset?: string } = {}) =>
    call<{ sessionId: string; agentPreset?: string }>('session.create', input),
  history: (input: { sessionId: string; beforeSeq?: number; maxMessages?: number }) =>
    call<{
      events: Array<{ event: { type: string; seq: number; time: number; data: unknown }; view?: unknown }>
      hasMore: boolean
      projections?: { asOfSeq: number; values: Record<string, unknown> }
    }>('session.history', input),
  prompt: (input: { sessionId: string; mode?: 'queue' | 'steer'; content: unknown[]; clientTimeZone?: string }) =>
    call<{ accepted: true; command?: { kind: 'success'; text?: string } }>('session.prompt', input),
  cancel: (input: { sessionId: string }) => call<{ accepted: true }>('session.cancel', input),
  rename: (input: { sessionId: string; title: string }) =>
    call<{ title: string; seq: number }>('session.rename', input),
  fork: (input: { sessionId: string; atSeq?: number }) => call<{ sessionId: string }>('session.fork', input),
  search: (input: { query: string }) =>
    call<{ items: SessionSearchItem[]; hasMore: boolean }>('session.search', input),
  models: (input: { sessionId: string }) =>
    call<{
      current: { provider: string; model: string; reasoningEffort?: string }
      routable: boolean
      groups: Array<{ id: string; name: string; models: Array<{ id: string; name: string }> }>
      failures: Array<{ id: string; name: string; message: string }>
    }>('session.models', input),
  selectModel: (input: { sessionId: string; provider: string; model: string; reasoningEffort?: string }) =>
    call<{ selected: { provider: string; model: string; reasoningEffort?: string } }>('session.selectModel', input),
}

// ----- Workspace -----

export const workspace = {
  list: () =>
    call<{
      items: Array<{
        workspaceId: string
        path: string
        title: string
        sessionIds: string[]
        createdAt: string
        updatedAt: string
      }>
      archivedSessionIds: string[]
    }>('workspace.list', {}),
  importDirectory: () => bridge().importDirectory(),
}

// ----- Skills -----

export const skill = {
  list: (input: { sessionId: string }) =>
    call<{
      skills: Array<{ name: string; description: string; whenToUse?: string; modelInvocable: boolean }>
    }>('skill.list', input),
}

// ----- Agent presets -----

export const agentPreset = {
  list: (input: { sessionId?: string } = {}) =>
    call<{
      presets: Array<{
        id: string
        trust: 'system' | 'user'
        isDefault: boolean
        name?: string
        description?: string
        broken?: string
      }>
      authorable: boolean
      hasDocument: boolean
    }>('agentPreset.list', input),
}

// ----- LLM -----

export const llm = {
  providers: () =>
    call<{
      providers: Array<{
        provider: string
        displayName: string
        settingsNs: string
        settingsPath: string[]
        active: boolean
        declared?: boolean
      }>
    }>('llm.providers', {}),
}

// ----- Artifacts -----

/**
 * Renderable product class. Mirrors `ArtifactKind` in
 * `packages/host/apiproxy/src/api/artifacts.ts`; the wire list is closed so
 * a renderer can switch on the discriminant without an undefined arm.
 */
export type ArtifactKind = 'html' | 'slides' | 'doc' | 'sheet' | 'chart'

/**
 * Producer of one artifact. Mirrors `ArtifactSource` in
 * `packages/host/apiproxy/src/api/artifacts.ts`.
 */
export type ArtifactSource =
  | 'tool-html'
  | 'tool-slides'
  | 'tool-doc'
  | 'tool-sheet'
  | 'tool-mermaid'
  | 'tool-svg'

/** Wire-side MIME media type vocabulary; closed like `ArtifactKind`. */
export type ArtifactMediaType =
  | 'text/html'
  | 'text/markdown'
  | 'image/svg+xml'
  | 'image/png'
  | 'image/jpeg'
  | 'application/pdf'

/**
 * One artifact row carried by every `artifact.*` value. The host brands
 * `artifactId` (`Branded<'ArtifactId'>`); the renderer never narrows on the
 * brand, so it degrades to `string` at this boundary.
 */
export interface ArtifactView {
  artifactId: string
  kind: ArtifactKind
  source: ArtifactSource
  mediaType: ArtifactMediaType
  bytes: number
  /** Optional human-readable title; absent when the producer named none. */
  title?: string
  /** Workspace owning the artifact; absent for unowned writes. */
  workspaceId?: string
  /** Session that produced the artifact; absent for unowned writes. */
  sessionId?: string
  /** ISO-8601 creation instant. */
  createdAt: string
  /** Optional display name; absent when the producer named none. */
  name?: string
}

export const artifact = {
  list: (input: { workspaceId?: string; sessionId?: string; kind?: ArtifactKind } = {}) =>
    call<{ items: ArtifactView[] }>('artifact.list', input),
  read: (input: { artifactId: string }) =>
    call<{ view: ArtifactView; bytesBase64: string }>('artifact.read', input),
  remove: (input: { artifactId: string }) =>
    call<{ removed: true }>('artifact.remove', input),
  save: async (input: { artifactId: string }) => {
    const result = await bridge().saveArtifact(input)
    if (result.ok) return result.value
    throw Object.assign(new Error(result.error.message), { code: result.error.code })
  },
  openInBrowser: async (input: { artifactId: string }) => {
    const result = await bridge().openArtifactInBrowser(input)
    if (result.ok) return result.value
    throw Object.assign(new Error(result.error.message), { code: result.error.code })
  },
}

/** Account wallet snapshot returned by `account.wallet.get`. */
export interface WalletView { userId: string; balanceMicros: number; updatedAt: number }
/** API-key metadata returned by `account.modelKeys.list`. */
export interface ModelKeyView {
  keyId: string
  userId: string
  label: string
  createdAt: number
  lastUsedAt: number | null
  revokedAt: number | null
}

export const wallet = {
  get: (input: { userId: string }) => call<WalletView>('account.wallet.get', input),
}

export const modelKeys = {
  list: (input: { userId: string }) => call<{ items: ModelKeyView[] }>('account.modelKeys.list', input),
}

/** Format integer micro-yuan as a localized CNY amount. */
export function formatCnyFromMicros(micros: number): string {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(micros / 1_000_000)
}

// ----- Subscriptions (SSE fan-out) -----

export function subscribeMux(
  listener: (envelope: { rpcId: string; method: string; payload: MuxFrame }) => void,
): Promise<() => Promise<void>> {
  return bridge().subscribeMux(listener)
}

export function subscribeHost(
  listener: (envelope: { rpcId: string; method: string; payload: HostFrame }) => void,
): Promise<() => Promise<void>> {
  return bridge().subscribeHost(listener)
}

export async function respond(
  rpcId: string,
  value: unknown,
  error?: { code: string; message: string; details?: Record<string, unknown> },
): Promise<void> {
  if (error) {
    return bridge().respond(rpcId, undefined, error)
  }
  return bridge().respond(rpcId, value)
}

// ----- Settings persistence -----

export async function getSession(): Promise<SessionState> {
  return bridge().getSession()
}

export async function updateSession(input: {
  baseUrl: string
  environment?: 'local' | 'cloud'
  lastLocation?: 'local' | 'cloud'
}): Promise<{ ok: true; value: { baseUrl: string } } | { ok: false; error: { code: string; message: string } }> {
  return bridge().updateSession(input)
}

// ----- Client update check -----

export const update = {
  getState: () => bridge().getAppUpdateState(),
  check: () => bridge().checkAppUpdate(),
  openDownload: () => bridge().openAppUpdateDownload(),
  subscribe: (listener: (state: AppUpdateState) => void) =>
    bridge().subscribeAppUpdateState(listener),
}

// ----- Auth (xiaowei multi-user bearer session lifecycle) -----

/**
 * Renderer-side wrappers around the `workbench:auth:*` IPC bridge. The
 * success branch returns the canonical `AuthState` projection so the
 * `useAuthStore` can write it directly; the failure branch surfaces the
 * host's wire code so SignInCard can map `RESEND_COOLDOWN` / `WRONG_CODE` /
 * `CODE_LOCKED` etc. into localized copy.
 */
export const auth = {
  /** Cold-start probe: read the persisted AuthState. */
  getState: async (): Promise<AuthState> => bridge().getAuthState(),
  /**
   * Mint a 6-digit verification code. Public method; works when fully
   * signed out. The host returns `retryAfterSeconds` so the UI can drive
   * the cooldown timer.
   */
  requestEmailCode: async (input: { email: string; invitationCode: string }): Promise<
    | { ok: true; value: RequestEmailCodeValue }
    | { ok: false; error: { code: string; message: string } }
  > => bridge().requestEmailCode(input),
  /** Register an account; the host fires the welcome bonus + provisions an API key. */
  signUp: async (input: {
    email: string
    password: string
    displayName?: string
    verificationCode?: string
    invitationCode: string
  }): Promise<
    | { ok: true; value: AuthState }
    | { ok: false; error: { code: string; message: string } }
  > => bridge().signUp(input),
  /** Sign in to an existing account. */
  signIn: async (input: { email: string; password: string }): Promise<
    | { ok: true; value: AuthState }
    | { ok: false; error: { code: string; message: string } }
  > => bridge().signIn(input),
  /** Revoke the current bearer and clear the persisted session. */
  signOut: async (): Promise<{ ok: true; value: AuthState }> => bridge().signOut(),
  /** Subscribe to AuthState fan-out (one fan-out per sign-in / sign-out / cold-start). */
  subscribe: async (listener: (state: AuthState) => void): Promise<() => void> =>
    bridge().subscribeAuthState(listener),
}

/** Account-owned invitation creation, repeat listing, and explicit regeneration. */
export const invites = {
  list: () => call<{ items: Array<{
    invitationId: string
    code: string | null
    codeMask: string
    createdAt: number
    expiresAt: number
    consumedAt: number | null
    redeemedBy: string | null
  }> }>('account.invites.list', {}),
  create: () => call<{
    invitationId: string
    code: string
    codeMask: string
    createdAt: number
    expiresAt: number
    consumedAt: number | null
    redeemedBy: string | null
  }>('account.invites.create', {}),
  rotate: (invitationId: string) => call<{
    invitationId: string
    code: string
    codeMask: string
    createdAt: number
    expiresAt: number
    consumedAt: number | null
    redeemedBy: string | null
  }>('account.invites.rotate', { invitationId }),
}

// ----- Helpers for consumers -----

/**
 * Resolve the display title for a `SessionListItem`. The server does not
 * store a top-level title; the title-projection plugin (if mounted) writes
 * `projections.values.title`. Fall back to "会话 {short id}" / "空会话".
 */
export function sessionTitle(item: SessionListItem): string {
  const fromProjection = item.projections?.values['title']
  if (typeof fromProjection === 'string' && fromProjection.trim().length > 0) {
    return fromProjection.trim()
  }
  if (item.blank) return '空会话'
  return `会话 ${item.sessionId.slice(0, 8)}`
}

/** Format a SessionListItem.updatedAt (epoch ms) as a human-readable string. */
export function formatSessionUpdatedAt(item: SessionListItem): string {
  if (!item.updatedAt) return ''
  try {
    return new Date(item.updatedAt).toLocaleString()
  } catch {
    return String(item.updatedAt)
  }
}
