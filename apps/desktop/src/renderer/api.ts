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
  HostFrame,
  MuxFrame,
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
}): Promise<{ ok: true; value: { baseUrl: string } } | { ok: false; error: { code: string; message: string } }> {
  return bridge().updateSession(input)
}

// ----- Update check (stub) -----

export const update = {
  getState: () => bridge().getAppUpdateState(),
  check: () => bridge().checkAppUpdate(),
  subscribe: (
    listener: (state: { status: 'idle' | 'checking' | 'up-to-date' | 'available' | 'error'; currentVersion: string }) => void,
  ) => bridge().subscribeAppUpdateState(listener),
}

// ----- Helpers for consumers -----

/**
 * Resolve the display title for a `SessionListItem`. The server does not
 * store a top-level title; the title-projection plugin (if mounted) writes
 * `projections.values.title`. Fall back to "会话 {short id}" / "空会话".
 */
export function sessionTitle(item: SessionListItem): string {
  const fromProjection = item.projections?.values?.['title']
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
