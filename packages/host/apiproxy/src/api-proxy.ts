/**
 * Host-side ApiProxy implementation. Signature discipline: unary takes the
 * narrow RpcRequest<P> and echoes request.rpcId on the RpcResponse<T>.
 */

import { createHash, randomUUID } from 'node:crypto'
import { mkdir, realpath, stat, writeFile, rename, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { z as zod } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { Agent, ModelSelection, ModelSelectionRef, AgentOptions, AgentStatus } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-presets/types'
import { AttachmentError, admitEncodedImages, admitEncodedDocuments } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef, DocumentAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { createUserMessage, freezeMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { errorChain } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, MessageSource, GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { isAppendSurfaceEvent, isJsonValue } from '@deepseek-ai/dsh-session'
import { SessionOwnerId as brandSessionOwnerId } from '@deepseek-ai/dsh-session'
import type { JsonValue, Session, SessionEvent, SessionEventMap, SessionHeader, SessionId, UserMessage } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import { SessionQueryError, type SessionSearchCursor } from '@deepseek-ai/dsh-session-query'
import { SubagentError } from '@deepseek-ai/dsh-subagent'
import type { SubagentListEntry as CatalogSubagentListEntry } from '@deepseek-ai/dsh-subagent'
import { isUserInvocable } from '@deepseek-ai/dsh-skill'
import type { Workspace, WorkspaceAccess, WorkspaceRecord } from '@deepseek-ai/dsh-workspace'
import {
  workspaceDomainState, workspaceRecord, WorkspaceId as brandWorkspaceId,
  WorkspaceMoveInvalidError, WorkspaceOrderInvalidError, WorkspaceUnknownSessionError,
} from '@deepseek-ai/dsh-workspace'
// Type-only: brings the `ctx.tools` Context merge into this program (viewFor reads presenters).
import {
  InvalidPresetIdError, PresetExistsError, PresetMountError,
  PresetNotWritableError, resolveSessionPreset, UnknownPresetError,
} from '@deepseek-ai/dsh-agent-presets'
import type { PresetBearingSession } from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-tools'
import type {
  ApiProxy, ConfigurableProviderView, CredentialView, GoalRef, HistoryEntry, HostFrame,
  ModelCatalogFailure, ModelProviderGroup,
  ModelReasoning, MuxFrame, PromptContentPart, QuestionResponsePayload, SessionListMetadata, SessionProjectionsBlock, SessionSearchItem,
  QueuedInboxItem, SessionSummary, SettingsNamespaceView, SubagentAddress, JobView, ToolEventView,
  WorkspaceId, WorkspaceView, UserContextKey, UserContextKind, UserContextView,
} from './api/index.ts'
import {
  DEFAULT_SESSION_LOG_COMPRESSION_LEVEL,
  flushLiveSessionLog,
  sessionLogExportDeps,
  sessionLogZipFilename,
  streamSessionLogZip,
  type SessionLogExportReady,
  type SessionLogCompressionLevel,
} from './session-export.ts'
import type { SessionRawArtifact } from '@deepseek-ai/dsh-session-persistence'
import {
  SESSION_SEARCH_RESULT_LIMIT,
  SESSION_SEARCH_SNIPPET_MAX_CODE_POINTS,
  truncateUnicodeCodePoints,
} from './api/session-search.ts'
// Type-only: resolves `ctx.get('sessionProjections')` to the projection registry.
import type {} from '@deepseek-ai/dsh-session-projection'
// Type-only: resolves `ctx.get('tasks')` to the background job registry.
import type {} from '@deepseek-ai/dsh-jobs'
import type { JobSnapshot } from '@deepseek-ai/dsh-jobs'
// Type-only: resolves `ctx.get('sessionProjectionCache')` (the cold listing column).
import type {} from '@deepseek-ai/dsh-session-projection-cache'
// GoalError narrows domain rejections to their stable codes at the wire boundary.
import { GoalError } from '@deepseek-ai/dsh-goal'
import type { GoalRef as CoreGoalRef } from '@deepseek-ai/dsh-goal'
// Type-only edges: resolve the command-change stream and `ctx.get('skills')`.
import type {} from '@deepseek-ai/dsh-commands'
// Type-only: the dynamic-package runner's forwarded-event declarations. Its
// client-safe `./types` subpath deliberately, not the package root — the root
// merges `ctx.dynamicCordisRunner`, and a dependency on that package would
// rebuild the api-remotes cycle this direction exists to avoid.
import type {} from '@deepseek-ai/dsh-cordis-host-runner/types'
import type {} from '@deepseek-ai/dsh-skill'
// The settings/credentials seams: brand guards run at this wire boundary; the
// service reads stay optional (`ctx.get`) so a composition without either
// provider still serves every other domain.
import { SettingsConflictError, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { SettingsDescriptor, SettingsNamespace, SettingsPathOp } from '@deepseek-ai/dsh-settings'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
// Value edge: the rename impl narrows the title service's validation failure; the import also resolves `ctx.get('sessionTitle')`.
import { SessionTitleInvalidError } from '@deepseek-ai/dsh-session-title'
import type { CallId } from '@deepseek-ai/dsh-llm/brand'
import type { ScopeKey } from '@deepseek-ai/dsh-scope'
import type { ApprovalOutcome, ApprovalRequestId } from '@deepseek-ai/dsh-user-approval'
// Side-effect type import: resolves the `approval/request` waterfall and
// `ctx.get('approval')` without a value dependency on the seam (optional composition).
import type {} from '@deepseek-ai/dsh-user-approval'
import { approvalResponsePayloadSchema } from './api/approvals.schema.ts'
import { imageLimitsProjectionSchema, sessionListMetadataProjectionSchema } from './api/sessions.schema.ts'
import { questionResponsePayloadSchema } from './api/questions.schema.ts'
import type { ClientResponse, RpcError, RpcReceipt, RpcRequest, RpcResponse, RpcPrincipal } from './api/rpc.ts'
import { RpcId } from './api/rpc.ts'
import type {
  AskUserQuestionAnswer, AskUserQuestionItem, AskUserQuestionRequest,
} from '@deepseek-ai/dsh-user-questions'
import { UserQuestionError } from '@deepseek-ai/dsh-user-questions'
import { DirectoryPickerError } from '@deepseek-ai/dsh-host-directory-picker'
// ---- xiaowei multi-user account seam ----
import type { SignedIn, AuthenticatedView, WalletView, LedgerEntry } from '@deepseek-ai/dsh-account-api-provider'
import type { IdentityError, EmailVerificationError, WalletError } from '@deepseek-ai/dsh-account-api-provider'
import type {
  ProvisionedKey,
  CustomModelId,
  CustomModelView as StoredCustomModelView,
} from '@deepseek-ai/dsh-account-api-provider'
import type { ModelKeyError } from '@deepseek-ai/dsh-account-api-provider'
import type { ArtifactView as ArtifactRegistryView } from '@deepseek-ai/dsh-artifact'
import { ArtifactError } from '@deepseek-ai/dsh-artifact'
import { SessionId as brandSessionId } from '@deepseek-ai/dsh-session'
import type { RpcErrorCode } from './api/rpc.ts'
import type { InvitationView } from './api/account.ts'
import type { ModelKeyView } from './api/model-keys.ts'
import type { AccountPluginView } from '@deepseek-ai/dsh-account-api-provider'
import type { CustomModelView } from './api/custom-models.ts'
import {
  ApiRemoteSessionNotFound as SessionNotFound,
  ApiRemoteSubagentSessionOwnership as SubagentSessionOwnership,
  API_REMOTE_FORWARDED_EVENTS,
  apiRemoteSubagentOwnershipError,
  createApiRemoteAgentResolver,
  hasApiRemoteSubagentOwner,
  inspectApiRemoteSession,
} from '@deepseek-ai/dsh-api-remotes'
import { canOpenNativePath, openNativePath, openNativeTextFile } from './native-path-opener.ts'
import { mountAccountPluginsIfConfigured } from './account-plugin-mount.ts'
import { accountInferenceOptions } from './api/account-inference.ts'
import type { AccountInferenceFrame } from '@deepseek-ai/dsh-llm-account-inference'
import type { WebSearchResult } from '@deepseek-ai/dsh-web'

/** Optional user-context provider consumed by the host RPC adapter. */
interface UserContextProvider {
  list(input: { kind?: UserContextKind; workspaceId?: string | null; limit?: number }): Promise<{ items: readonly UserContextView[] }>
  get(input: { kind: UserContextKind; key: UserContextKey; workspaceId?: string | null }): Promise<
    | { found: true; entry: UserContextView }
    | { found: false; missing: true }
  >
  set(input: { kind: UserContextKind; key: UserContextKey; workspaceId?: string | null; value: string }): Promise<UserContextView>
  delete(input: { kind: UserContextKind; key: UserContextKey; workspaceId?: string | null }): Promise<{ removed: boolean }>
}

/** Page size when history is called without maxMessages. */
const DEFAULT_MAX_MESSAGES = 50

/** Provider work budget: at most 100 calls and 2,000 inspected hits. */
const SESSION_SEARCH_PROVIDER_CALL_LIMIT = 100

/** Bound cold-log stat fan-out and settle each started batch before cancellation returns. */
const COLD_SUMMARY_BATCH_SIZE = 16
/** Default maximum artifact size eligible for one cold blankness read. */
export const DEFAULT_COLD_BLANK_PROBE_MAX_BYTES = 1024
/** Bounds for the single-request local directory import MVP. */
export const DIRECTORY_IMPORT_MAX_FILES = 200
/** Maximum decoded bytes accepted for one imported file. */
export const DIRECTORY_IMPORT_MAX_FILE_BYTES = 5 * 1024 * 1024
/** Maximum decoded bytes accepted across one directory import. */
export const DIRECTORY_IMPORT_MAX_TOTAL_BYTES = 25 * 1024 * 1024

/** Conversation message event types (the pagination counting unit). */
const MESSAGE_TYPES = new Set(['user/message', 'assistant/message'])
/** Stable provider id for account custom-model routing. */
const CUSTOM_MODEL_PROVIDER_ROUTE = 'xiaowei-custom'

/** Render an unknown failure for operator logs without assuming an Error instance. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Read a service error's stable discriminant without importing account runtimes. */
function serviceErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

/** Structural account-error guard; keeps the cloud gateway free of runtime imports. */
function isServiceError<T extends { code: string }>(error: unknown): error is T {
  return serviceErrorCode(error) !== undefined
}

/** Validate one prompt as a batch before publishing any durable image object. */
async function durablePromptContent(
  ctx: Context,
  content: readonly PromptContentPart[],
): Promise<{ blocks: ContentBlock[]; files: readonly DocumentAttachmentRef[] }> {
  const refs = await admitEncodedImages(ctx.attachments, content.filter(part => part.type === 'image'))
  const fileInputs = content.filter(part => part.type === 'file')
  const files = await admitEncodedDocuments(ctx.attachments, fileInputs.map(part => ({ mediaType: part.mediaType, data: part.data, kind: part.kind, ...(part.name === undefined ? {} : { name: part.name }), summary: '' })))
  let next = 0
  const fileHint = files.length === 0 ? [] : [{ type: 'text' as const, text: files.map(file => `[uploaded-file attachmentId=${file.attachmentId} name=${file.name ?? '(unnamed)'} kind=${file.kind}]\n${file.summary}\nUse document_read for page/slide/worksheet details.${file.kind === 'xlsx' ? ' Use sheet_analyze to create a table, bar chart, and pie chart analysis page.' : ''}`).join('\n\n') }]
  const blocks: ContentBlock[] = [...content.filter(part => part.type !== 'file').map(part => part.type === 'text'
    ? { type: 'text' as const, text: part.text }
    : { type: 'image' as const, attachment: refs[next++] as ImageAttachmentRef }), ...fileHint]
  return { files, blocks }
}

/** Search durable content for an image reference, including nested tool results. */
function imageBlockIn(content: unknown, match: (ref: ImageAttachmentRef) => boolean): ImageAttachmentRef | undefined {
  if (!Array.isArray(content)) return undefined
  for (const value of content) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue
    const block = value as { type?: unknown; attachment?: unknown; content?: unknown }
    if (block.type === 'image' && typeof block.attachment === 'object' && block.attachment !== null) {
      const ref = block.attachment as ImageAttachmentRef
      if (match(ref)) return ref
    }
    if (block.type === 'tool-result') {
      const nested = imageBlockIn(block.content, match)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

/** Search every durable event carrier that can own model-visible content. */
function imageInEvent(event: SessionEvent, match: (ref: ImageAttachmentRef) => boolean): ImageAttachmentRef | undefined {
  const data = event.data as {
    content?: unknown
    message?: { content?: unknown }
    inserted?: Array<{ content?: unknown }>
    chunk?: { type?: unknown; block?: unknown }
  }
  const direct = imageBlockIn(data.content, match)
  if (direct !== undefined) return direct
  if (data.message !== undefined) {
    const wrapped = imageBlockIn(data.message.content, match)
    if (wrapped !== undefined) return wrapped
  }
  if (data.inserted !== undefined) {
    for (const message of data.inserted) {
      const inserted = imageBlockIn(message.content, match)
      if (inserted !== undefined) return inserted
    }
  }
  if (event.type === 'assistant/chunk' && data.chunk?.type === 'block-end') {
    return imageBlockIn([data.chunk.block], match)
  }
  return undefined
}

/** Resolve the first reference matching one opaque id. */
function referencedImage(events: readonly SessionEvent[], attachmentId: string): ImageAttachmentRef | undefined {
  for (const event of events) {
    const found = imageInEvent(event, ref => String(ref.attachmentId) === attachmentId)
    if (found !== undefined) return found
  }
  return undefined
}

/** Strict browser-zone profile: UTC or an IANA Area/Location-style identifier. */
const IANA_TIME_ZONE = /^[A-Za-z][A-Za-z0-9_+.-]*(?:\/[A-Za-z0-9_+.-]+)+$/

/** Validate and canonicalize one browser-supplied IANA zone at the wire boundary. */
function canonicalClientTimeZone(value: string): string | undefined {
  if (value.length === 0 || value.trim() !== value
    || (value !== 'UTC' && !IANA_TIME_ZONE.test(value))) return undefined
  try {
    const canonical = new Intl.DateTimeFormat('en-US', { timeZone: value })
      .resolvedOptions().timeZone
    /* v8 ignore next -- Intl returns UTC or a canonical IANA Area/Location for accepted input. */
    if (canonical !== 'UTC' && !IANA_TIME_ZONE.test(canonical)) return undefined
    return canonical
  } catch {
    // Intl rejects unsupported zone names; the RPC maps that parser rejection below.
    return undefined
  }
}

/** Read live abort state across awaits without treating it as synchronously immutable. */
function isAborted(signal: AbortSignal): boolean {
  return signal.aborted
}

/**
 * Message-boundary pagination: count maxMessages append-origin messages
 * backwards from the window tail. Replacement copies never entered the
 * conversation a reader sees — they restate a shadowed range for the model
 * alone — so they consume no quota; the page stays one contiguous raw range,
 * which keeps a compaction's log-only `compaction/summary` record on the same page as its
 * replacement. The cut is the starting seq of the oldest message group (chunks
 * group via sourceEventSeqs — never cut mid-message). The tail page naturally
 * includes the in-progress partial.
 */
function paginate(
  events: readonly SessionEvent[],
  beforeSeq: number | undefined,
  maxMessages: number,
): { events: SessionEvent[]; hasMore: boolean } {
  const window = beforeSeq === undefined ? [...events] : events.filter(event => event.seq < beforeSeq)
  let count = 0
  let cut = 0
  for (let i = window.length - 1; i >= 0; i--) {
    const event = window[i] as SessionEvent
    if (!MESSAGE_TYPES.has(event.type) || !isAppendSurfaceEvent(event)) continue
    count++
    const sources = (event as { sourceEventSeqs?: number[] }).sourceEventSeqs
    let groupStart = event.seq
    if (sources !== undefined) {
      for (const source of sources) {
        if (source < groupStart) groupStart = source
      }
    }
    if (count >= maxMessages) {
      cut = groupStart
      break
    }
  }
  const page = window.filter(event => event.seq >= cut)
  return { events: page, hasMore: cut > 0 }
}

/** Wrap an ok result echoing the request's rpcId. */
function ok<T>(request: RpcRequest<unknown>, value: T): RpcResponse<T> {
  return { rpcId: request.rpcId, result: { ok: true, value } }
}

/**
 * Build the provider/model catalog over every registered route. Shared by the
 * session-scoped `session.models` and host-scoped `llm.models`. Catalog
 * membership stays advisory: an unlisted session selection remains valid for
 * provider dispatch, but is not injected back into the selector after its
 * owning catalog stops advertising it. Per-provider failures ride `failures`
 * without failing the sound groups; groups that advertise nothing are dropped.
 */
async function buildModelCatalog(ctx: Context): Promise<{
  groups: ModelProviderGroup[]
  failures: ModelCatalogFailure[]
}> {
  const catalog = await Promise.all(ctx.llm.listProviders().map(async (provider) => {
    try {
      const models = await ctx.llm.listModels(provider.id)
      const entries = await Promise.all(models.map(async (model) => {
        const resolved = await ctx.llm.resolveModelInfo(provider.id, model.id)
        const reasoning: ModelReasoning | undefined = resolved.reasoning === undefined
          ? undefined
          : {
            efforts: resolved.reasoning.efforts.map(effort => ({
              id: effort.id,
              name: effort.name,
              ...effort.description === undefined
                ? {}
                : { description: effort.description },
            })),
            ...resolved.reasoning.defaultEffort === undefined
              ? {}
              : { defaultEffort: resolved.reasoning.defaultEffort },
          }
        return {
          id: model.id,
          name: model.name,
          ...model.description === undefined ? {} : { description: model.description },
          ...reasoning === undefined ? {} : { reasoning },
        }
      }))
      const group: ModelProviderGroup = {
        id: provider.id,
        name: provider.name,
        models: entries,
      }
      return { kind: 'group' as const, group }
    } catch (error: unknown) {
      const failure: ModelCatalogFailure = {
        id: provider.id,
        name: provider.name,
        message: error instanceof Error ? error.message : String(error),
      }
      return { kind: 'failure' as const, failure }
    }
  }))
  return {
    groups: catalog.flatMap(item => item.kind === 'group' ? [item.group] : []).filter(group => group.models.length > 0),
    failures: catalog.flatMap(item => item.kind === 'failure' ? [item.failure] : []),
  }
}

/** Wrap an error result echoing the request's rpcId. */
function err<T>(request: RpcRequest<unknown>, error: RpcError): RpcResponse<T> {
  return { rpcId: request.rpcId, result: { ok: false, error } }
}

/**
 * The RPC refusal a preset failure becomes, or undefined when the failure is
 * about something else.
 *
 * Both the session-create path and the switch path can be handed the same two
 * failures, and a client that has to branch on the code needs them worded the
 * same from either.
 * @param request - the request being answered.
 * @param error - the thrown value.
 * @returns the refusal, or undefined when the caller should keep handling.
 */
function presetFailure(request: RpcRequest<unknown>, error: unknown): RpcResponse<never> | undefined {
  if (error instanceof UnknownPresetError) {
    return err(request, {
      code: 'agent-preset-not-found',
      message: error.message,
      details: { agentPreset: error.presetId, available: [...error.available] },
    })
  }
  if (error instanceof PresetMountError) {
    return err(request, {
      code: 'agent-preset-invalid',
      message: error.message,
      details: { agentPreset: error.presetId, reason: error.reason },
    })
  }
  return undefined
}

/** Simple async queue: core callbacks push, the AsyncIterable pulls; abort/return cleans up. */
class FrameQueue<F> {
  private buffer: F[] = []
  private waiter: (() => void) | undefined
  private done = false

  push(item: F): void {
    if (this.done) return
    this.buffer.push(item)
    this.waiter?.()
  }

  end(): void {
    this.done = true
    this.waiter?.()
  }

  async *iterate(signal: AbortSignal, cleanup: () => void): AsyncGenerator<F> {
    const onAbort = (): void => { this.end() }
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      while (true) {
        while (this.buffer.length > 0) yield this.buffer.shift() as F
        if (this.done || signal.aborted) return
        await new Promise<void>((resolve) => { this.waiter = resolve })
        this.waiter = undefined
      }
    } finally {
      signal.removeEventListener('abort', onAbort)
      cleanup()
    }
  }
}

/**
 * Server-side frame mint: pure pushes get a fresh rpcId per frame (answerable
 * frames — approval/question requested — mint their stable id in their
 * pending registries instead).
 */
function frame<F>(payload: F): RpcRequest<F> {
  return { rpcId: RpcId(randomUUID()), payload }
}

/**
 * Narrow one allowlisted host event's argument list to the JSON values the
 * wrapper frame carries. A rejected argument is an allowlist mistake (the
 * forwarded path applies no projection), not hostile input, so it throws rather
 * than degrading to a lossy frame. The throw surfaces where the forwarding
 * listener runs, so the emitter's own listener containment logs it and drops
 * that frame — loud in the Host log, not at load or at the emit. Exported for
 * the test that owns this decision: every currently allowlisted event has a
 * statically JSON-safe payload, so a type-legal `ctx.emit` cannot reach the
 * rejection branch.
 * @param event - forwarded host event name, named in the failure.
 * @param args - the emitter's argument list.
 * @returns the same arguments typed as JSON values.
 */
export function assertJsonArgs(event: string, args: readonly unknown[]): JsonValue[] {
  for (const [index, arg] of args.entries()) {
    if (!isJsonValue(arg)) {
      throw new Error(`forwarded host event "${event}" argument ${index} is not lossless JSON data`)
    }
  }
  return args as JsonValue[]
}

/** Queue the subscription baseline frame. */
function subscribeSession(queue: FrameQueue<RpcRequest<MuxFrame>>, session: Session): void {
  queue.push(frame({ type: 'session/subscribed', sessionId: session.id, lastSeq: session.seq - 1 }))
}

/**
 * Project registry snapshots onto the wire view, dropping the three internal
 * fields {@link JobView} documents as absent.
 */
function jobViews(snapshots: readonly JobSnapshot[]): JobView[] {
  return snapshots.map(job => ({
    id: job.id,
    kind: job.kind,
    label: job.label,
    status: job.status,
    ...job.detail === undefined ? {} : { detail: job.detail },
    startedAt: job.startedAt,
    ...job.finishedAt === undefined ? {} : { finishedAt: job.finishedAt },
  }))
}

/**
 * Whether the session's conversation has started: no turn has run yet (a
 * turn is one model-loop execution). Standalone plugin events — command
 * lifecycle records, plan/mode, titles, goals — never open a turn, so
 * running `/plan` or `/goal` on a fresh session keeps it blank
 * (list-hidden, reusable).
 */
function sessionBlank(session: Session): boolean {
  return !session.events.some(event => event.type === 'turn/start')
}

/** Advance the Session-list hint projection by one committed event. */
function applySessionListMetadata(state: SessionListMetadata, event: SessionEvent): SessionListMetadata {
  const blank = state.blank && event.type !== 'turn/start'
  const lastPromptAt = event.type === 'user/message' && event.data.source.kind === 'user'
    ? event.time
    : state.lastPromptAt
  return blank === state.blank && lastPromptAt === state.lastPromptAt
    ? state
    : { blank, lastPromptAt }
}

/** Fold exact list metadata for an attached Session. */
function sessionListMetadata(events: readonly SessionEvent[]): SessionListMetadata {
  let state: SessionListMetadata = { blank: true, lastPromptAt: null }
  for (const event of events) state = applySessionListMetadata(state, event)
  return state
}

/** Sort by creation or latest human prompt, whichever is newer. */
function sessionListUpdatedAt(header: SessionHeader, metadata: SessionListMetadata | undefined): number {
  return Math.max(header.createdAt, metadata?.lastPromptAt ?? 0)
}

/** Shared Session-header projection for list baselines and creation frames. */
function sessionListFields(header: SessionHeader, events: readonly SessionEvent[] = []): {
  parentSessionId?: SessionId
  origin?: 'subagent'
  cwd?: string
  agentPreset?: string
} {
  // The preset comes from the log, not the header: a session that switched
  // while blank ran its turns under the newer composition, and a picker
  // showing the creation-time value would contradict what the model saw.
  const agentPreset = resolveSessionPreset({ header, events })
  return {
    ...header.parentSession === undefined ? {} : { parentSessionId: header.parentSession },
    ...header.origin === undefined ? {} : { origin: header.origin },
    ...header.cwd === undefined ? {} : { cwd: header.cwd },
    ...agentPreset === undefined ? {} : { agentPreset },
  }
}

/** SessionSummary projection for attached (in-memory) sessions. */
function summarize(session: Session, running: boolean): SessionSummary {
  const metadata = sessionListMetadata(session.events)
  return {
    sessionId: session.id,
    updatedAt: sessionListUpdatedAt(session.header, metadata),
    running,
    blank: metadata.blank,
    ...sessionListFields(session.header, session.events),
  }
}

/**
 * Verify a possibly blank cold Session only when its physical artifact passes
 * the configured per-Session size check. A stale `blank: true`, an
 * absent cache row, a large or location-less artifact, and read failures all
 * resolve to visible (`false`); listing must never hide a conversation on a
 * cache hint or an unavailable optimization.
 */
async function probeColdSessionMetadata(
  ctx: Context,
  persistence: SessionPersistence,
  meta: SessionHeader,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<SessionListMetadata | undefined> {
  if (maxBytes === 0) return undefined
  signal?.throwIfAborted()
  const location = persistence.locate(meta)
  if (location === undefined) return undefined
  signal?.throwIfAborted()
  let size: number
  try {
    size = (await stat(location.path)).size
  } catch {
    signal?.throwIfAborted()
    return undefined
  }
  if (size > maxBytes) return undefined
  try {
    const { events } = await persistence.readFrom(meta.id, 0, signal)
    signal?.throwIfAborted()
    return sessionListMetadata(events)
  } catch (error) {
    signal?.throwIfAborted()
    ctx.logger.warn(`session.list: blank probe for "${meta.id}" failed (serving it as visible): ${String(error)}`)
    return undefined
  }
}

/** SessionSummary projection for a cold persisted Session. */
async function summarizeCold(
  ctx: Context,
  persistence: SessionPersistence,
  meta: SessionHeader,
  metadata: SessionListMetadata | undefined,
  blankProbeMaxBytes: number,
  signal?: AbortSignal,
): Promise<SessionSummary> {
  const probed = metadata?.blank === false
    ? undefined
    : await probeColdSessionMetadata(ctx, persistence, meta, blankProbeMaxBytes, signal)
  return {
    sessionId: meta.id,
    updatedAt: sessionListUpdatedAt(meta, probed ?? metadata),
    running: false,
    blank: metadata?.blank === false ? false : probed?.blank ?? false,
    // Header-only: reading the log for a blank-window preset switch would
    // defeat the same index read, and attaching the session replaces this row
    // with `summarize()`, which resolves the switch from the events.
    ...sessionListFields(meta),
  }
}

/** Map a browse-primitive failure onto the wire error vocabulary (unknown throws stay internal). */
function directoryError(error: unknown): RpcError {
  if (error instanceof DirectoryPickerError) {
    return { code: error.code, message: error.message, details: { path: error.path } }
  }
  return { code: 'internal', message: error instanceof Error ? error.message : String(error), details: {} }
}

/** Resolved Agent model and project-directory defaults consumed by the API implementation. */
export interface ApiProxyDefaults {
  /** Preset permitted for authenticated account sessions. */
  accountAgentPreset?: string
  /**
   * The model selection a session starts from when its own log names none. Read on
   * every access rather than captured, so a default saved during this process
   * reaches the sessions that have not run a turn yet.
   */
  defaultModelSelection: () => ModelSelection
  /**
   * Record a selection as the new default. Either absent, or a closure that
   * may itself decline — the gateway plugin always passes one, and it no-ops
   * when the deployment mounts no settings provider or when the write races
   * service teardown. A switch then stays process-local. A rejection is
   * reported and swallowed: the switch already applies to its own session,
   * and undoing it because storage failed would be the worse outcome.
   */
  saveDefaultModelSelection?: (selection: ModelSelection) => Promise<void>
  /** Default project directory for new sessions whose create request carries no cwd. */
  cwd: string
  /** Root below which authenticated account workspaces are created. */
  accountWorkspaceRoot?: string
  /** Native open-with-default-application; injectable for carrier tests. */
  openPath?: (path: string, signal: AbortSignal) => Promise<void>
  /** Native text-editor handoff; injectable for settings-document tests. */
  openTextFile?: (path: string, signal: AbortSignal) => Promise<void>
  /** Validated DEFLATE level for session-log ZIP entries; defaults to 6. */
  sessionExportCompressionLevel?: SessionLogCompressionLevel
  /** Maximum artifact size eligible for one cold blankness read. */
  coldBlankProbeMaxBytes?: number
  /**
   * Whether handing a path to the native opener can work at all — the
   * `hasDocument` capability the preset roster reports, and the switch
   * between opening a preset directory and answering its path as text.
   * Absent, an injected `openPath` counts as openable and everything else
   * falls back to platform detection ({@link canOpenNativePath}).
   */
  canOpenPath?: () => boolean
}

/** The tool/call payload fields the presenter path reads. */
interface ToolCallData { callId: string; name: string; arguments: string }
/**
 * One outstanding approval question: the stable server-request id, the frame
 * material replayed to late mux subscribers, and the resolver that settles the
 * answerer's promise back into `ctx.approval`.
 */
interface PendingApproval {
  rpcId: RpcId
  sessionId: SessionId
  approvalId: ApprovalRequestId
  toolName: string
  callId?: CallId
  reason?: string
  resolve(outcome: ApprovalOutcome): void
}

/** Project a pending entry into its answerable mux frame (initial push and mux-open replay share it). */
function requestedFrame(pending: PendingApproval): RpcRequest<MuxFrame> {
  return {
    rpcId: pending.rpcId,
    payload: {
      type: 'approval/requested',
      sessionId: pending.sessionId,
      approvalId: pending.approvalId,
      toolName: pending.toolName,
      ...pending.callId === undefined ? {} : { callId: pending.callId },
      ...pending.reason === undefined ? {} : { reason: pending.reason },
    },
  }
}

/** One host-owned question wait, addressed by the stable server-request id. */
interface PendingQuestion {
  rpcId: RpcId
  sessionId: SessionId
  questions: AskUserQuestionItem[]
  resolve: (answer: AskUserQuestionAnswer) => void
  reject: (error: UserQuestionError) => void
  signal?: AbortSignal
  onAbort?: () => void
}

/** Validate one answer batch against the exact question request it resolves. */
function matchesQuestions(payload: QuestionResponsePayload, pending: PendingQuestion): boolean {
  if (payload.sessionId !== pending.sessionId) return false
  const answers = payload.answer.answers
  if (answers.length !== pending.questions.length) return false
  return answers.every((answer, index) => {
    const question = pending.questions[index] as AskUserQuestionItem
    if (answer.id !== question.id) return false
    if (new Set(answer.selected).size !== answer.selected.length) return false
    const custom = answer.custom?.trim()
    if (custom !== undefined && custom === '') return false
    if (question.multiSelect !== true) {
      if (custom !== undefined && answer.selected.length > 0) return false
      if (answer.selected.length > 1) return false
    }
    const labels = new Set(question.options?.map(option => option.label) ?? [])
    return answer.selected.every(label => labels.has(label))
  })
}

/**
 * Compute the render intent for a tool/call or tool/result event through the
 * presenters registered at this moment; every other event type gets none. A
 * result's presenter needs its call's parsed args — `argsFor` supplies them
 * (live: the per-session call table; history: an in-page backscan), returning
 * undefined when the pairing is unavailable (e.g. the call fell off the page),
 * which soft-falls to no view. Presenter or JSON.parse throws also soft-fall:
 * the client's documented default (generic JSON card) covers every miss.
 */
function viewFor(
  ctx: Context,
  event: SessionEvent,
  argsFor: (callId: string) => unknown,
  // Presenters live with the definitions, and definitions live in the scope
  // chain: a preset registers its tools into its standing layer. A live agent
  // is a scope whose chain passes through its preset; a cold read passes the
  // preset's standing key directly — no agent, no resume. An undefined scope
  // sees only the global layer, which is the pre-preset deployment shape.
  scope?: ScopeKey,
): ToolEventView | undefined {
  try {
    if (event.type === 'tool/call') {
      const { name, arguments: raw } = event.data as ToolCallData
      const view = ctx.tools.get(name, scope)?.presentCall?.(JSON.parse(raw))
      return view === undefined ? undefined : { for: 'call', view }
    }
    if (event.type === 'tool/result') {
      const { message, meta } = event.data
      const [result] = message.content
      const callId = message.source.callId
      const call = argsFor(callId) as { name: string; args: unknown } | undefined
      if (call === undefined) return undefined
      const view = ctx.tools.get(call.name, scope)?.presentResult?.(call.args, {
        content: result.content,
        isError: result.isError === true,
        ...meta === undefined ? {} : { meta },
      })
      return view === undefined ? undefined : { for: 'result', view }
    }
  } catch (error: unknown) {
    // A throwing presenter (or unparseable arguments) must not break delivery;
    // the event still ships, just without a view.
    console.error(`api-proxy: presenter failed for ${event.type}, falling back to generic: ${String(error)}`)
  }
  return undefined
}

/**
 * Resolve a tool/result's call pairing by scanning a window of events backwards
 * for the matching tool/call. Used by the history path (the page is the
 * window — a cross-page pairing soft-falls to no view) and by live-path table
 * misses after a reconnect-eviction.
 */
function backscanArgs(events: readonly SessionEvent[], callId: string): { name: string; args: unknown } | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i] as SessionEvent
    if (event.type !== 'tool/call') continue
    const data = event.data as ToolCallData
    if (data.callId !== callId) continue
    try {
      return { name: data.name, args: JSON.parse(data.arguments) }
    } catch {
      // Unparseable stored arguments: same soft-fall as a live parse failure.
      return undefined
    }
  }
  return undefined
}

/** Render one detached history page through the same presenter path as ordinary history. */
function historyPage(
  ctx: Context,
  events: readonly SessionEvent[],
  beforeSeq: number | undefined,
  maxMessages: number | undefined,
  scope?: ScopeKey,
): { events: HistoryEntry[]; hasMore: boolean } {
  const page = paginate(events, beforeSeq, maxMessages ?? DEFAULT_MAX_MESSAGES)
  return {
    events: page.events.map((event) => {
      const view = viewFor(ctx, event, callId => backscanArgs(page.events, callId), scope)
      return { event, ...view === undefined ? {} : { view } }
    }),
    hasMore: page.hasMore,
  }
}

/**
 * The projection baseline for one history tail page: the registry's
 * watermark-cache snapshot — one fully synchronous read (no await between the
 * page slice and this), so all values and `asOfSeq` form a single consistent
 * cut and `asOfSeq` equals the window tail event seq. The carrier holds zero
 * domain knowledge (each value passed its unit's own schema inside the
 * registry). An absent registry means the deployment has no projection seam:
 * the whole block is absent and clients treat every key as capability-absent.
 */
/**
 * Which session a transcript read is served from. An attached session is the
 * live object and keeps appending, so its events and projection baseline are
 * read together in one synchronous step; a detached one is already a frozen
 * inspection.
 */
type HistorySource =
  | { readonly kind: 'attached'; readonly session: Session }
  | { readonly kind: 'detached'; readonly header: SessionHeader; readonly events: SessionEvent[] }

function projectionsFor(ctx: Context, session: Session): SessionProjectionsBlock | undefined {
  const registry = ctx.get('sessionProjections')
  if (registry === undefined) return undefined
  return registry.snapshot(session)
}

/**
 * The projection baseline of one session.list row, fail-soft: attached
 * sessions cut the registry's live watermark cache; cold sessions view the
 * persisted projection cache's identity-checked stored rows (zero log loads
 * either way — the listing use case the cache exists for). The block shape
 * (values + asOfSeq) matches the history tail's, so a client seeds its
 * value store under the same higher-seq-wins rule. Any failure — and an
 * empty value set — yields an absent block: a listing without projections
 * is degraded, never broken.
 */
function listProjectionsFor(ctx: Context, meta: SessionHeader, session: Session | undefined): SessionProjectionsBlock | undefined {
  try {
    const block = session !== undefined
      ? ctx.get('sessionProjections')?.snapshot(session)
      : ctx.get('sessionProjectionCache')?.cachedSnapshot(meta)
    return block !== undefined && Object.keys(block.values).length > 0 ? block : undefined
  } catch (error) {
    ctx.logger.warn(`session.list: projection column for "${meta.id}" failed (serving the row without it): ${String(error)}`)
    return undefined
  }
}

/** Projection baseline for a detached history tail without Agent activation. */
function detachedProjectionsFor(
  ctx: Context,
  events: readonly SessionEvent[],
): SessionProjectionsBlock | undefined {
  const registry = ctx.get('sessionProjections')
  if (registry === undefined) return undefined
  return registry.restore({}, events, 0).snapshot
}

/**
 * Best-effort projections for one subagent history page, fail-soft like
 * {@link listProjectionsFor}: a registered unit throwing on a corrupt payload
 * never blocks transcript reading — the page is served without the block.
 * @param ctx - context carrying the logger for the degradation warning.
 * @param childSessionId - the child whose page is being decorated.
 * @param compute - the arm-specific fold (live watermark or detached restore).
 * @returns the projections block, or undefined when the fold failed.
 */
function subagentHistoryProjections(
  ctx: Context,
  childSessionId: SessionId,
  compute: () => SessionProjectionsBlock | undefined,
): SessionProjectionsBlock | undefined {
  try {
    return compute()
  } catch (error) {
    ctx.logger.warn(`subagent.history: projections for "${childSessionId}" failed (serving the page without them): ${String(error)}`)
    return undefined
  }
}

/** Map continuation admission failures without exposing provider details. */
function subagentPromptError(
  request: RpcRequest<{ childSessionId: SessionId }>,
  error: unknown,
  signal: AbortSignal,
): RpcResponse<never> {
  const childSessionId = request.payload.childSessionId
  if (signal.aborted) {
    return err(request, { code: 'cancelled', message: 'subagent prompt was cancelled', details: {} })
  }
  if (error instanceof SubagentError) {
    switch (error.code) {
      case 'NOT_RESUMABLE':
        return err(request, {
          code: 'subagent-not-resumable',
          message: 'subagent cannot be resumed',
          details: { childSessionId },
        })
      case 'UNAUTHORIZED':
        return err(request, {
          code: 'subagent-unauthorized',
          message: 'subagent does not belong to this parent',
          details: { childSessionId },
        })
      case 'DRAINING':
      case 'ACTIVATION_CLOSING':
      case 'CONTINUATION_UNAVAILABLE':
      case 'PERSISTENCE_UNAVAILABLE':
        return err(request, {
          code: 'subagent-delivery-unavailable',
          message: 'subagent follow-up is temporarily unavailable',
          details: { childSessionId },
        })
      default:
        break
    }
  }
  return err(request, { code: 'internal', message: 'subagent prompt failed', details: {} })
}

/** Stable RPC face of the missing projections capability, shared by every catalog read path. */
function projectionsUnavailableError(): RpcError {
  return {
    code: 'internal',
    message: 'subagent catalog is unavailable: this deployment does not mount the sessionProjections registry (load @deepseek-ai/dsh-session-projection)',
    details: {},
  }
}

/** Verify one address and mode against the complete direct-child catalog. */
async function catalogChild(
  ctx: Context,
  address: SubagentAddress,
  signal?: AbortSignal,
): Promise<{
  entry?: Extract<CatalogSubagentListEntry, { kind: 'child' }>
  error?: RpcError
}> {
  const { parentSessionId, childSessionId, mode } = address
  try {
    const entries = await ctx.subagents.listChildren(parentSessionId, signal)
    const entry = entries.find(candidate => candidate.id === childSessionId)
    if (entry === undefined || (entry.kind === 'child' && entry.mode !== mode)) {
      return {
        error: {
          code: 'subagent-not-found',
          message: `session "${childSessionId}" is not a ${mode} direct child of "${parentSessionId}"`,
          details: { parentSessionId, childSessionId },
        },
      }
    }
    if (entry.kind === 'diagnostic') {
      return {
        error: {
          code: 'subagent-catalog-diagnostic',
          message: `subagent "${childSessionId}" is ${entry.reason}`,
          details: { parentSessionId, childSessionId, reason: entry.reason },
        },
      }
    }
    return { entry }
  } catch (error: unknown) {
    if (signal?.aborted || (error instanceof SubagentError && error.code === 'CANCELLED')) {
      return { error: { code: 'cancelled', message: 'subagent catalog read was cancelled', details: {} } }
    }
    if (error instanceof SubagentError && error.code === 'SUBAGENT_CONTROL_PROJECTIONS_UNAVAILABLE') {
      return { error: projectionsUnavailableError() }
    }
    return { error: { code: 'internal', message: 'subagent catalog read failed', details: {} } }
  }
}

/**
 * The requested preset differs from the one this session already runs.
 *
 * A session's composition is fixed at creation: its history was produced under
 * that preset's tools, so adopting the identity under a different one would
 * replay tool calls the rebuilt agent cannot make. Naming a different preset
 * is therefore a caller error rather than a switch.
 */
/** The roster is absent: this deployment composes no agent presets at all. */
function noRoster(agentPreset: string): RpcError {
  return {
    code: 'agent-preset-not-found',
    message: 'this deployment composes no agent presets',
    details: { agentPreset, available: [] },
  }
}

/** Map one authoring/roster failure onto its wire code. */
function presetError(agentPreset: string, error: unknown): RpcError {
  if (error instanceof UnknownPresetError) {
    return {
      code: 'agent-preset-not-found',
      message: error.message,
      details: { agentPreset: error.presetId, available: [...error.available] },
    }
  }
  if (error instanceof PresetNotWritableError) {
    return { code: 'agent-preset-read-only', message: error.message, details: { agentPreset, reason: error.message } }
  }
  if (error instanceof InvalidPresetIdError || error instanceof PresetExistsError) {
    return { code: 'agent-preset-invalid', message: error.message, details: { agentPreset, reason: error.message } }
  }
  return { code: 'internal', message: `agent preset "${agentPreset}": ${String(error)}`, details: {} }
}

class AgentPresetConflict extends Error {
  constructor(
    readonly sessionId: SessionId,
    readonly requestedPreset: string,
    readonly existingPreset: string | undefined,
  ) {
    super(
      existingPreset === undefined
        ? `session "${sessionId}" records no agent preset, so it cannot be adopted under one; `
        + 'a deployment composing no roster records none on any session — '
        : `session "${sessionId}" already runs agent preset ${JSON.stringify(existingPreset)}; `
      + `requested ${JSON.stringify(requestedPreset)}. A session's preset is fixed at creation.`,
    )
  }
}

/** Requested identity already belongs to a session with another project cwd. */
class SessionCwdConflict extends Error {
  constructor(
    readonly sessionId: SessionId,
    readonly requestedCwd: string,
    readonly existingCwd: string | undefined,
  ) {
    super(
      `session "${sessionId}" already exists with cwd ${JSON.stringify(existingCwd)}; `
      + `requested ${JSON.stringify(requestedCwd)}`,
    )
  }
}

/** An explicit Host naming operation would duplicate another Workspace title. */
class WorkspaceNameConflictError extends Error {
  constructor(readonly workspaceName: string) {
    super(`workspace name '${workspaceName}' is already in use`)
    this.name = 'WorkspaceNameConflictError'
  }
}

/** Shared workspace-not-found error response of the workspace.* mutation rows. */
function workspaceNotFound<T>(request: RpcRequest<unknown>, workspaceId: string): RpcResponse<T> {
  return err(request, {
    code: 'workspace-not-found',
    message: `workspace "${workspaceId}" not found`,
    details: { workspaceId },
  })
}

/** Wire projection of one workspace entity (the workspace.* value row). */
function workspaceView(workspace: Workspace): WorkspaceView {
  return {
    workspaceId: workspace.id,
    path: workspace.path,
    title: workspace.title,
    sessionIds: [...workspace.sessionIds],
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
  }
}

/** Wire projection of the durable record carried by `domain/changed`. */
function changedWorkspaceView(workspaceId: string, value: unknown): WorkspaceView {
  const record: WorkspaceRecord = workspaceRecord.parse(value)
  return {
    workspaceId: workspaceId as WorkspaceId,
    path: record.path,
    title: record.title,
    sessionIds: [...record.sessionIds],
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

/**
 * Implement ApiProxy over a composed host context.
 * @param ctx - a context with the Host spine and Workspace registry mounted.
 * @param defaults - host routing and project-directory defaults.
 * @returns the ApiProxy implementation.
 */
export function createApiProxy(ctx: Context, defaults: ApiProxyDefaults): ApiProxy {
  const sessionExportCompressionLevel = defaults.sessionExportCompressionLevel
    ?? DEFAULT_SESSION_LOG_COMPRESSION_LEVEL
  const coldBlankProbeMaxBytes = defaults.coldBlankProbeMaxBytes
    ?? DEFAULT_COLD_BLANK_PROBE_MAX_BYTES
  /** The seed model each create/resume declares; re-read so it never goes stale. */
  const agentOptions = (): AgentOptions => {
    const { provider, model } = defaults.defaultModelSelection()
    return { provider, model }
  }
  type WebModelSelectionRef = ModelSelectionRef & { current: ModelSelection }
  const selections = new WeakMap<Agent, WebModelSelectionRef>()
  /**
   * Serializes `agentPreset.select` per session. Two concurrent selects both
   * pass the blank check, and the second `unmountPresetFor` then finds nothing
   * to unmount because the first already removed the record — leaving two
   * compositions registered into one agent layer. The client's `busy` flag is
   * not enforcement: the wire is reachable directly.
   */
  const presetSwitches = new Map<SessionId, Promise<unknown>>()
  /** Client-chosen identity creation/resume, deduplicated across concurrent retries. */
  const sessionCreations = new Map<SessionId, Promise<Agent>>()
  /** Serializes path ownership and explicit title checks with Workspace mutations. */
  let workspaceCreationChain = Promise.resolve()
  const pendingQuestions = new Map<RpcId, PendingQuestion>()
  const pendingApprovals = new Map<RpcId, PendingApproval>()
  const muxQueues = new Set<FrameQueue<RpcRequest<MuxFrame>>>()
  const imageAdmissionChains = new WeakMap<Agent, Promise<void>>()
  const importedDirectories = new Map<string, Workspace>()

  const accountRoot = async (owner: ReturnType<typeof brandSessionOwnerId>): Promise<string> => {
    const base = defaults.accountWorkspaceRoot ?? join(defaults.cwd, '.dsh-accounts')
    await mkdir(base, { recursive: true, mode: 0o700 })
    const canonicalBase = await realpath(base)
    const hashDir = join(canonicalBase, createHash('sha256').update(String(owner)).digest('hex'))
    await mkdir(hashDir, { recursive: true, mode: 0o700 })
    const canonicalHashDir = await realpath(hashDir)
    if (!contained(canonicalBase, canonicalHashDir)) throw new Error('account workspace hash directory escapes configured root')
    const path = join(canonicalHashDir, 'workspaces')
    await mkdir(path, { recursive: true, mode: 0o700 })
    const canonicalPath = await realpath(path)
    if (!contained(canonicalBase, canonicalPath)) throw new Error('account workspace root escapes configured root')
    return canonicalPath
  }
  const contained = (root: string, target: string): boolean => {
    if (!isAbsolute(target)) return false
    const rest = relative(root, target)
    return rest === '' || (rest !== '..' && !rest.startsWith(`..${dirname('/')}`) && !rest.startsWith('../') && !rest.startsWith('..\\'))
  }
  const accountPath = async (
    request: RpcRequest<unknown>,
    path: string | undefined,
  ): Promise<{ root: string; path: string } | undefined> => {
    const owner = requestOwner(request)
    if (owner === undefined) return undefined
    const root = await accountRoot(owner)
    const target = await realpath(path ?? root)
    if (!contained(root, target)) throw new Error('path is outside the account workspace root')
    return { root, path: target }
  }

  /** Serialize image admission with model selection for one agent. */
  function serializeImageAdmission<T>(agent: Agent, operation: () => Promise<T>): Promise<T> {
    const result = (imageAdmissionChains.get(agent) ?? Promise.resolve()).then(operation)
    imageAdmissionChains.set(agent, result.then(() => undefined, () => undefined))
    return result
  }

  /**
   * Install or return the session-local model selection that prompt assembly snapshots.
   *
   * Precedence, resolved on EVERY read rather than seeded once: a selection
   * made in this process, else the session's own latest logged request/header,
   * else the live Agent default. Re-reading keeps the two tiers exact in both
   * directions: a session with a recorded request derives its selection from
   * its log, while a blank session (New Session reuses one rather than minting
   * another) reads any default saved after it was created. There is no create-time
   * per-session override tier on this wire — if one returns (a create-options
   * contribution), it must fold in between the selection and the log.
   */
  function selectionFor(agent: Agent): WebModelSelectionRef {
    const installed = selections.get(agent)
    if (installed !== undefined) return installed
    let picked: ModelSelection | undefined
    const selection: WebModelSelectionRef = {
      get current(): ModelSelection {
        if (picked !== undefined) return picked
        // Incrementally folded by the session, so a per-step read costs
        // O(new events) rather than a rescan.
        const logged = agent.session.requestHeader()?.config
        if (logged === undefined) return defaults.defaultModelSelection()
        return {
          provider: logged.provider,
          model: logged.model,
          ...logged.reasoningEffort === undefined
            ? {}
            : { reasoningEffort: logged.reasoningEffort },
        }
      },
      set current(next: ModelSelection) {
        picked = next
      },
      assembled: undefined,
    }
    installModelSelection(agent.ctx, selection)
    selections.set(agent, selection)
    return selection
  }

  /** Pre-publication setup used by both fresh and resumed Web agents. */
  function installSelection(agentCtx: Context): void {
    const agent = agentCtx.agent
    if (agent === undefined) throw new Error('api-proxy: agent setup has no scoped agent')
    selectionFor(agent)
  }

  /**
   * Reject an attempt to run an existing session under a different preset.
   *
   * A caller that names no preset always adopts the session as it is, so the
   * common paths — reconnecting, resuming, retrying a create — are unaffected.
   * @param sessionId - the identity being adopted.
   * @param requested - the preset the request named, if any.
   * @param existing - the preset the session RUNS, if any; both callers resolve
   * it from the log, which differs from the creation header once a blank
   * session has switched.
   * @throws when both are present and differ.
   */
  function assertPresetUnchanged(
    sessionId: SessionId,
    requested: string | undefined,
    existing: string | undefined,
  ): void {
    if (requested === undefined || requested === existing) return
    throw new AgentPresetConflict(sessionId, requested, existing)
  }

  /**
   * Resolve the preset an agent will be composed from, and the setup that
   * installs it.
   *
   * The id is resolved BEFORE the session exists because the session boundary
   * snapshots `meta` before asynchronous setup begins — a preset discovered
   * during setup could never reach the header. Mounting still happens in
   * setup, where a failure rolls the whole creation back rather than leaving a
   * published session whose capabilities are half-installed.
   *
   * A deployment with no preset roster composes nothing and every session
   * shares the host composition, which is the behavior before presets existed.
   * @param presetId - the requested preset, or `undefined` for the default.
   * @returns the id to record on the header (absent without a roster) and the setup callback.
   * @throws when the roster supplies no such preset.
   */
  async function composeAgent(
    presetId: string | undefined,
    ownerId?: string,
    pluginIds?: readonly string[],
    sessionEvents?: readonly SessionEvent[],
  ): Promise<{
    agentPreset?: string
    setup: (agentCtx: Context) => Promise<void>
  }> {
    const presets = ctx.get('agentPresets')
    if (presets === undefined) {
      return {
        setup: async (agentCtx: Context) => {
          installSelection(agentCtx)
          if (ownerId !== undefined) {
            if (ctx.get('accountPluginFactory') !== undefined) {
              const pluginInput = sessionEvents === undefined
                ? pluginIds === undefined ? { userId: ownerId } : { userId: ownerId, pluginIds }
                : { userId: ownerId, events: sessionEvents }
              await mountAccountPluginsIfConfigured(agentCtx, pluginInput, true)
            }
          }
        },
      }
    }
    const resolvedId = (await presets.resolve(presetId)).id
    return {
      agentPreset: resolvedId,
      setup: async (agentCtx: Context) => {
        installSelection(agentCtx)
        await presets.mount(agentCtx, resolvedId)
        if (ownerId !== undefined) {
          if (ctx.get('accountPluginFactory') !== undefined) {
            const pluginInput = sessionEvents === undefined
              ? pluginIds === undefined ? { userId: ownerId } : { userId: ownerId, pluginIds }
              : { userId: ownerId, events: sessionEvents }
            await mountAccountPluginsIfConfigured(agentCtx, pluginInput, true)
          }
        }
      },
    }
  }

  const hasSubagentOwner = (
    session: Pick<Session, 'header'>,
    agent: Agent | undefined,
  ): boolean => hasApiRemoteSubagentOwner(ctx, session, agent)
  const subagentOwnershipError = (sessionId: SessionId): RpcError =>
    apiRemoteSubagentOwnershipError(sessionId)
  const inspectServable = (sessionId: SessionId): Promise<{ meta: SessionHeader; events: SessionEvent[] }> =>
    inspectApiRemoteSession(ctx, sessionId)
  // Cold resume composes the preset the session recorded, for the same reason
  // `session.create` does: its history was produced under that composition.
  // Every generic entry point — prompt, models, commands — arrives here, so
  // leaving it out meant a session opened after a restart ran on host tools
  // and the deployment persona. Resolved from the LOG, not the header: a
  // session that switched while blank ran its turns under the newer
  // composition, and the header is written once at creation. Reading the
  // header here would silently undo the switch on the next restart and
  // restore that history under the old tool set.
  const agentFor = createApiRemoteAgentResolver(ctx, {
    agentOptions,
    setup: async ({ meta, events }) => {
      const ownerId = meta.ownerId === undefined ? undefined : String(meta.ownerId)
      return (await composeAgent(resolveSessionPreset({ header: meta, events }), ownerId, undefined, events)).setup
    },
  })

  /** Send one transient frame to every connected mux consumer. */
  function broadcast(payload: MuxFrame): void {
    const envelope = frame(payload)
    for (const queue of muxQueues) queue.push(envelope)
  }

  // Projection change feed → session/projection push frames. The carrier
  // mints the wire frame (the Service Definition package holds no wire vocabulary); the
  // child activates only when a projection registry is composed, and the
  // subscription unwinds with this gateway's fiber.
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.onChanged((session, key, value, seq) => {
      broadcast({ type: 'session/projection', sessionId: session.id, key, value, seq })
    })
  })

  // The cache supplies recency and a monotonic non-blank hint. A cached
  // `blank: true` remains only a prefix fact and is verified on the cold path.
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register<'sessionListMetadata', SessionListMetadata>({
      key: 'sessionListMetadata',
      stateSchema: sessionListMetadataProjectionSchema,
      init: () => ({ blank: true, lastPromptAt: null }),
      apply: applySessionListMetadata,
      wire: { viewSchema: sessionListMetadataProjectionSchema, view: state => state },
      stateVersion: 1,
    })
  })

  // The imageLimits projection unit: the attachments config this proxy
  // enforces at prompt admission, constant per host boot. `apply` keeps the
  // same state reference for every event, so no change frames are ever
  // pushed — baselines alone carry the value — and clients pre-check intake
  // and label upload affordances from it. Registered here, not in the
  // attachment Service Definition: dsh-llm depends on dsh-attachment, so the
  // seam package cannot reference the projection registry without a cycle,
  // and the per-message rules the value describes are this proxy's own
  // admission checks. The child activates only while both seams are composed.
  // `view` reading the live service instead of the (null) state is sanctioned
  // exactly for boot-constant units: the value cannot change within a process
  // lifetime, so the fold stays observationally pure, and a stale persisted
  // cache row re-viewing to the current config is the correct outcome.
  ctx.inject(['sessionProjections', 'attachments'], (projectionCtx) => {
    projectionCtx.sessionProjections.register<'imageLimits', null>({
      key: 'imageLimits',
      stateSchema: zod.null(),
      init: () => null,
      apply: state => state,
      wire: { viewSchema: imageLimitsProjectionSchema, view: () => projectionCtx.attachments.imageLimits },
      stateVersion: 1,
    })
  })

  /** Project both durable inbox lists, optionally including the splice currently being emitted. */
  const queueItems = (
    agent: Agent,
    splice?: SessionEventMap['agent/inbox/spliced'],
  ): QueuedInboxItem[] => {
    const project = (target: 'next-turn' | 'next-step'): readonly UserMessage[] => {
      const messages = target === 'next-turn' ? agent.inbox.nextTurn : agent.inbox.nextStep
      return splice?.target === target
        ? messages.toSpliced(splice.start, splice.removedCount ?? 0, ...splice.inserted)
        : messages
    }
    return [
      ...project('next-turn').map(message => ({ id: message.id, placement: 'queued' as const, message })),
      ...project('next-step').map(message => ({
        id: message.id,
        // Only user-origin messages are steering; injected context (approval
        // notices, task completion, attached snapshots) is not a user action
        // and must not render as a pending steering bubble.
        placement: message.source.kind === 'user' ? 'steering' as const : 'context' as const,
        message,
      })),
    ]
  }

  ctx.on('session/event', (session, event) => {
    if (event.type !== 'agent/inbox/spliced') return
    const agent = ctx.agents.get(session.id)
    if (agent?.session !== session) return
    broadcast({ type: 'session/queue', sessionId: session.id, items: queueItems(agent, event.data) })
  })

  /** Remove a wait before settling it: synchronous deletion makes the first claimant win. */
  function claimQuestion(pending: PendingQuestion, outcome: 'answered' | 'cancelled'): void {
    pendingQuestions.delete(pending.rpcId)
    if (pending.signal !== undefined && pending.onAbort !== undefined) {
      pending.signal.removeEventListener('abort', pending.onAbort)
    }
    broadcast({
      type: 'question/resolved', sessionId: pending.sessionId,
      questionRpcId: pending.rpcId, outcome,
    })
  }

  const disposeProvider = ctx.userQuestions.registerProvider({
    ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer> {
      const sessionId = request.agent?.id
      if (sessionId === undefined) {
        return Promise.reject(new UserQuestionError(
          'web user interaction requires an agent-owned session', 'ASK_MISSING_AGENT'))
      }
      return new Promise<AskUserQuestionAnswer>((resolve, reject) => {
        const rpcId = RpcId(randomUUID())
        const pending: PendingQuestion = {
          rpcId, sessionId, questions: request.questions, resolve, reject,
          ...(request.signal === undefined ? {} : { signal: request.signal }),
        }
        const onAbort = (): void => {
          claimQuestion(pending, 'cancelled')
          reject(new UserQuestionError(
            'ask_user_question was aborted before the user answered', 'ASK_ABORTED'))
        }
        pending.onAbort = onAbort
        pendingQuestions.set(rpcId, pending)
        request.signal?.addEventListener('abort', onAbort, { once: true })
        const envelope: RpcRequest<MuxFrame> = {
          rpcId,
          payload: { type: 'question/requested', sessionId, questions: request.questions },
        }
        for (const queue of muxQueues) queue.push(envelope)
      })
    },
  })
  ctx.effect(() => () => {
    disposeProvider()
    for (const pending of [...pendingQuestions.values()]) {
      claimQuestion(pending, 'cancelled')
      pending.reject(new UserQuestionError(
        'web user-questions provider was disposed', 'ASK_ABORTED'))
    }
  }, 'api-proxy: user-questions provider')

  // --- Approval pending registry ------------------------------------------
  // The proxy is the approval channel for every agent this host owns: an ask
  // through `ctx.approval` becomes an answerable server-request on the mux
  // stream (stable rpcId), settled by POST /api/respond. The entry survives
  // client disconnects — mux-open replays still-pending requested frames with
  // the same rpcId (the refresh-recovery baseline) — and withdraws on the
  // ask's own abort signal (turn cancel), pushing `cancelled` to subscribers.
  if (ctx.get('approval') !== undefined) {
    // Teardown parity with the question provider above: a gateway disposed
    // while approvals are pending settles every entry as 'cancelled' (the
    // service's fail-closed vocabulary), so no ask promise dangles past the
    // proxy's lifetime and subscribers see the withdrawal.
    ctx.effect(() => () => {
      for (const pending of [...pendingApprovals.values()]) pending.resolve('cancelled')
    }, 'api-proxy: approval registry teardown')
    ctx.on('approval/request', (req, next) => {
      // Dispatch rides a microtask behind the service's own signal check: an
      // abort landing in that window would register the abort listener AFTER
      // the signal fired — never invoked, entry pending forever, zombie frame
      // on every mux replay. Settle synchronously instead of publishing.
      if (req.signal?.aborted === true) return Promise.resolve<ApprovalOutcome>('cancelled')
      // The audit pair `approval/asked` is already appended by the service
      // before dispatch, but dispatch rides a microtask: parallel tool calls
      // can append several asked events before any answerer runs. THIS
      // request's event is therefore the newest asked event that is still
      // undecided, unclaimed by another pending entry, and — when the ask
      // names a call — carries the same callId.
      const events = req.agent.session.events
      const claimed = new Set<ApprovalRequestId>()
      for (const entry of pendingApprovals.values()) claimed.add(entry.approvalId)
      const decided = new Set<ApprovalRequestId>()
      let approvalId: ApprovalRequestId | undefined
      for (let i = events.length - 1; i >= 0; i -= 1) {
        const event = events[i] as SessionEvent
        if (event.type === 'approval/decided') {
          decided.add(event.data.id)
        } else if (event.type === 'approval/asked') {
          if (decided.has(event.data.id) || claimed.has(event.data.id)) continue
          // Symmetric pairing: a callId-bearing ask only takes its own call's
          // record, and a callId-less ask only takes a callId-less record —
          // so neither shape can steal the other's audit id under parallel
          // asks. (Today every producer — the tool executor — passes callId;
          // the callId-less arm guards any future non-tool asker.)
          if ((req.callId ?? null) !== (event.data.callId ?? null)) continue
          approvalId = event.data.id
          break
        }
      }
      // No asked event means the request bypassed the service's audit path —
      // not this channel's question; delegate to the fail-closed default.
      if (approvalId === undefined) return next()
      const id = approvalId
      return new Promise<ApprovalOutcome>((resolve) => {
        const settle = (outcome: ApprovalOutcome): void => {
          /* v8 ignore next 3 -- defensive double-settle guard: respond() routes
             through the pending table (a settled id is not-pending before it can
             re-settle) and the first settle removes the abort listener, so no
             reachable path settles twice; kept against future settle callers. */
          if (!pendingApprovals.delete(pending.rpcId)) return
          req.signal?.removeEventListener('abort', onAbort)
          broadcast({ type: 'approval/resolved', sessionId: pending.sessionId, approvalId: id, outcome })
          // A cancelled ask was already settled by the service's own signal
          // race, which discards this late resolution; resolving is a no-op
          // there and keeps this promise from dangling forever.
          resolve(outcome)
        }
        const onAbort = (): void => { settle('cancelled') }
        const pending: PendingApproval = {
          rpcId: RpcId(randomUUID()),
          sessionId: req.agent.session.id,
          approvalId: id,
          toolName: req.toolName,
          ...req.callId === undefined ? {} : { callId: req.callId },
          ...req.reason === undefined ? {} : { reason: req.reason },
          resolve: settle,
        }
        pendingApprovals.set(pending.rpcId, pending)
        req.signal?.addEventListener('abort', onAbort, { once: true })
        const envelope = requestedFrame(pending)
        for (const queue of muxQueues) queue.push(envelope)
      })
    })
  }

  type SessionReadState = {
    id: SessionId
    header: SessionHeader
    events: SessionEvent[]
  }

  /** Read one stable session prefix without acquiring an Agent owner. */
  async function readSessionState(sessionId: SessionId): Promise<SessionReadState> {
    const attached = ctx.sessions.get(sessionId)
    if (attached !== undefined) {
      return {
        id: attached.id,
        header: attached.header,
        events: [...attached.events],
      }
    }
    const inspected = await inspectServable(sessionId)
    return { id: inspected.meta.id, header: inspected.meta, events: inspected.events }
  }

  /** Return the account owner for a request; local callers retain single-user access. */
  function requestOwner(request: RpcRequest<unknown>): ReturnType<typeof brandSessionOwnerId> | undefined {
    return request.principal?.kind === 'account' ? brandSessionOwnerId(request.principal.userId) : undefined
  }

  /** Hide both absent and foreign sessions behind the same wire error. */
  function sessionNotFound(request: RpcRequest<unknown>, sessionId: SessionId): RpcResponse<never> {
    return err(request, {
      code: 'session-not-found',
      message: `session "${sessionId}" not found`,
      details: { sessionId },
    })
  }

  function sessionVisibleTo(request: RpcRequest<unknown>, session: Pick<Session, 'header'>): boolean {
    const owner = requestOwner(request)
    return owner === undefined || session.header.ownerId === owner
  }

  /** Agent-preset roster operations address host-owned files and are local-only. */
  function requireLocalPresetAccess(request: RpcRequest<unknown>): RpcError | undefined {
    return requestOwner(request) === undefined ? undefined : {
      code: 'unauthenticated',
      message: 'remote accounts cannot access host agent presets',
      details: {},
    }
  }

  /** Authorize one session before any operation can inspect or mutate it. */
  async function authorizeSession(request: RpcRequest<unknown>, sessionId: SessionId): Promise<RpcError | undefined> {
    const owner = requestOwner(request)
    if (owner === undefined) return undefined
    try {
      const state = await readSessionState(sessionId)
      return state.header.ownerId === owner ? undefined : {
        code: 'session-not-found', message: `session "${sessionId}" not found`, details: { sessionId },
      }
    } catch (error: unknown) {
      if (error instanceof SessionNotFound) return { code: 'session-not-found', message: `session "${sessionId}" not found`, details: { sessionId } }
      throw error
    }
  }

  /** Resolve the Workspace inherited by a fork without making ordinary loose lineage grouped. */
  async function forkWorkspace(source: Pick<Session, 'id' | 'header'>): Promise<Workspace | undefined> {
    const owner = source.header.ownerId
    const access = owner === undefined
      ? { kind: 'local' as const }
      : { kind: 'account' as const, userId: owner }
    const workspaces = ctx.workspaceRegistry.list(access)
    const direct = workspaces.find(workspace => workspace.sessionIds.includes(source.id))
    if (direct !== undefined || source.header.origin !== 'subagent') return direct

    const lineage = await ctx.sessionQuery.traceSession(source.id)
    for (const ancestor of lineage.ancestors) {
      const workspace = workspaces.find(candidate => candidate.sessionIds.includes(ancestor.header.id))
      if (workspace !== undefined) return workspace
    }
    return undefined
  }

  /**
   * Resolve which session one transcript read is served from, without
   * acquiring an Agent owner. This is the read's only asynchronous step
   * besides ensuring the composition; {@link historyCutOf} takes the cut.
   * @param sessionId - the transcript being read.
   * @returns the attached session, or the inspected detached header and events.
   * @throws {@link ApiRemoteSessionNotFound} when no project-backed session has that identity.
   */
  async function historySourceFor(sessionId: SessionId): Promise<HistorySource> {
    const attached = ctx.sessions.get(sessionId)
    if (attached !== undefined) return { kind: 'attached', session: attached }
    const inspected = await inspectServable(sessionId)
    return { kind: 'detached', header: inspected.meta, events: inspected.events }
  }

  /**
   * The header and events {@link presenterScopeFor} reads to decide which
   * composition a transcript ran under.
   * @param source - the live or detached session this read is served from.
   * @returns that session's creation header and its events.
   */
  function sourceSession(source: HistorySource): PresetBearingSession {
    if (source.kind === 'detached') return { header: source.header, events: source.events }
    return { header: source.session.header, events: source.session.events }
  }

  /**
   * One transcript cut: the events and the projection baseline that describe
   * the SAME log position.
   *
   * Synchronous, and the two reads sit next to each other, because an attached
   * session keeps appending: an `await` between them would serve events cut at
   * N beside a baseline folded to N+1, which is one response describing two
   * moments. The caller does its awaiting before this call.
   * @param source - the live or detached session this read is served from.
   * @param includeProjections - whether the caller asked for the baseline (a tail page does).
   * @returns the events and, when asked, the baseline for that same position.
   */
  function historyCutOf(
    source: HistorySource,
    includeProjections: boolean,
  ): { events: SessionEvent[]; projections?: SessionProjectionsBlock } {
    if (source.kind === 'detached') {
      const projections = includeProjections ? detachedProjectionsFor(ctx, source.events) : undefined
      return { events: source.events, ...projections === undefined ? {} : { projections } }
    }
    const events = [...source.session.events]
    const projections = includeProjections ? projectionsFor(ctx, source.session) : undefined
    return { events, ...projections === undefined ? {} : { projections } }
  }

  /**
   * The registry view scope a transcript's presenters resolve in.
   *
   * A live agent is that scope itself (its chain passes through its preset's
   * standing layer). A cold session resolves its preset from the LOG, and the
   * preset's STANDING key serves without resuming anything — ensuring the
   * mount composes plugins but starts no agent, session, or turn. No roster,
   * no recorded preset, or a preset the roster no longer supplies all fall
   * back to the global layer: the transcript still serves, with the generic
   * cards a viewless entry renders.
   *
   * Reading the header alone would render a session that switched while blank
   * through the composition it was CREATED with. Every tool only the newer
   * preset registers resolves to no presenter there, and the transcript
   * silently degrades to generic cards for exactly the calls its history is
   * made of.
   * @param sessionId - the transcript being read.
   * @param session - that session's header and log (attached or inspected).
   * @returns the scope to pass to presenter lookups, or undefined for global.
   */
  async function presenterScopeFor(
    sessionId: SessionId,
    session: PresetBearingSession,
  ): Promise<ScopeKey | undefined> {
    const live = ctx.get('agents')?.get(sessionId)
    if (live !== undefined) return live
    const presets = ctx.get('agentPresets')
    if (presets === undefined) return undefined
    try {
      // An unrecorded preset (a log from before the roster existed) renders
      // through the DEFAULT preset's standing layer: that is the composition
      // an unnamed session composes today, and presenters are pure display,
      // so the worst a mismatch produces is the generic card it had anyway.
      return await presets.standingKeyFor(resolveSessionPreset(session))
    } catch {
      // Swallows only the unknown/unusable-preset rejection from the roster:
      // a deleted or broken preset must degrade this read, never fail it.
      return undefined
    }
  }

  /** Resolve one requested identity to a live agent, creating or resuming it once. */
  async function ensureSession(
    sessionId: SessionId,
    cwd: string,
    checkPersistedIdentity: boolean,
    presetId?: string,
    ownerId?: ReturnType<typeof brandSessionOwnerId>,
  ): Promise<Agent> {
    let creation = sessionCreations.get(sessionId)
    if (creation === undefined) {
      creation = (async () => {
        const attached = ctx.sessions.get(sessionId)
        const live = ctx.agents.get(sessionId)
        if (attached !== undefined && hasSubagentOwner(attached, live)) {
          throw new SubagentSessionOwnership(sessionId)
        }
        if (attached !== undefined && ownerId !== undefined && attached.header.ownerId !== ownerId) {
          throw new Error(`session "${sessionId}" is owned by another account`)
        }
        if (live !== undefined) return live

        const persistence = checkPersistedIdentity ? ctx.get('sessionPersistence') : undefined
        const stored = persistence === undefined
          ? undefined
          : (await persistence.list()).find(header => header.id === sessionId)
        if (persistence !== undefined && stored !== undefined) {
          const inspected = await persistence.inspect(sessionId)
          if (ownerId !== undefined && inspected.meta.ownerId !== ownerId) {
            throw new Error(`session "${sessionId}" is owned by another account`)
          }
          // Ownership first: explicit-id adoption of a session-backed
          // subagent must answer `agent-busy` regardless of the requested
          // cwd (the api/commands.ts contract), not a cwd conflict.
          if (hasSubagentOwner({ header: inspected.meta }, undefined)) {
            throw new SubagentSessionOwnership(sessionId)
          }
          if (inspected.meta.cwd !== cwd) {
            throw new SessionCwdConflict(sessionId, cwd, inspected.meta.cwd)
          }
          // Resolved from the log, not the header: a session that switched
          // while blank ran every turn under the newer composition.
          const storedPreset = resolveSessionPreset({ header: inspected.meta, events: inspected.events })
          assertPresetUnchanged(sessionId, presetId, storedPreset)
          // The stored preset wins over anything the request names: a resumed
          // session's history was produced under that composition, and
          // rebuilding it differently would replay tool calls the model can no
          // longer make.
          return (await ctx.agents.resume({
            resumeSessionId: sessionId,
            agentOptions: agentOptions(),
            setup: (await composeAgent(
              storedPreset, ownerId === undefined ? undefined : String(ownerId), undefined, inspected.events,
            )).setup,
          })).agent
        }

        try {
          await mkdir(cwd, { recursive: true })
        } catch (error: unknown) {
          throw new Error(`failed to ensure project directory "${cwd}": ${String(error)}`, { cause: error })
        }
        const accountFactory = ctx.get('accountPluginFactory')
        const pluginIds = ownerId === undefined || accountFactory === undefined
          ? undefined
          : await accountFactory.selected({ userId: String(ownerId) })
        const composition = await composeAgent(presetId, ownerId === undefined ? undefined : String(ownerId), pluginIds)
        const pluginSeed = ownerId === undefined || accountFactory === undefined || pluginIds === undefined
          ? undefined
          : accountFactory.selectionSeed({ pluginIds })
        return (await ctx.agents.create({
          sessionId,
          ...pluginSeed === undefined ? {} : { seed: [pluginSeed] },
          agentOptions: agentOptions(),
          meta: {
            cwd,
            ...ownerId === undefined ? {} : { ownerId },
            ...composition.agentPreset === undefined ? {} : { agentPreset: composition.agentPreset },
          },
          setup: composition.setup,
        })).agent
      })().catch((error: unknown) => {
        // Another Host entry path may have published the same identity while
        // this operation crossed an asynchronous persistence/filesystem step.
        const live = ctx.agents.get(sessionId)
        if (live !== undefined) {
          if (hasSubagentOwner(live.session, live)) throw new SubagentSessionOwnership(sessionId)
          return live
        }
        const attached = ctx.sessions.get(sessionId)
        if (attached !== undefined && hasSubagentOwner(attached, undefined)) {
          throw new SubagentSessionOwnership(sessionId)
        }
        throw error
      }).finally(() => {
        sessionCreations.delete(sessionId)
      })
      sessionCreations.set(sessionId, creation)
    }
    const agent = await creation
    if (hasSubagentOwner(agent.session, agent)) throw new SubagentSessionOwnership(sessionId)
    // Beside the cwd check for the same reason, and after the await so it
    // covers every path that yields a live agent — freshly created, adopted
    // live, resumed from disk, or recovered by the concurrent-creation catch.
    assertPresetUnchanged(sessionId, presetId, resolveSessionPreset(agent.session))
    if (agent.session.header.cwd !== cwd) {
      throw new SessionCwdConflict(sessionId, cwd, agent.session.header.cwd)
    }
    return agent
  }

  /** Serialize path adoption so concurrent requests resolve one registration. */
  function ensureWorkspace(
    path: string,
    access: WorkspaceAccess,
    title?: string,
  ): Promise<{ workspace: Workspace; created: boolean }> {
    const operation = workspaceCreationChain.then(async () => {
      const existing = await ctx.workspaceRegistry.resolveByPath(path, access)
      if (existing !== undefined) return { workspace: existing, created: false }
      return { workspace: await ctx.workspaceRegistry.create(path, title, access), created: true }
    })
    workspaceCreationChain = operation.then(() => undefined, () => undefined)
    return operation
  }

  /**
   * Build the session.list baseline shared by listing and search visibility.
   * Attached sessions come from memory; servable cold sessions merge from
   * persistence, and the final order is newest-first.
   */
  async function listVisibleSessionSummaries(
    signal?: AbortSignal,
    owner?: ReturnType<typeof brandSessionOwnerId>,
  ): Promise<SessionSummary[]> {
    signal?.throwIfAborted()
    const summarizeAttached = (session: Session): SessionSummary => {
      const agent = ctx.agents.get(session.id)
      const projections = listProjectionsFor(ctx, session.header, session)
      return {
        ...summarize(session, agent?.status === 'running'),
        ...projections === undefined ? {} : { projections },
      }
    }
    const items = ctx.sessions.list().filter(session => owner === undefined || session.header.ownerId === owner).map(summarizeAttached)
    signal?.throwIfAborted()
    const attached = new Set(items.map(item => item.sessionId))
    const persistence = ctx.get('sessionPersistence')
    if (persistence !== undefined) {
      const cold = (await persistence.list(signal))
        .filter(meta => !attached.has(meta.id) && meta.cwd !== undefined && (owner === undefined || meta.ownerId === owner))
      signal?.throwIfAborted()
      for (let offset = 0; offset < cold.length; offset += COLD_SUMMARY_BATCH_SIZE) {
        signal?.throwIfAborted()
        const batch = cold.slice(offset, offset + COLD_SUMMARY_BATCH_SIZE)
        const settled = await Promise.allSettled(
          batch.map(async (meta) => {
            // Projection hints remain optional. Blank verification may read
            // this Session's artifact only when it passes the configured size check.
            const projections = listProjectionsFor(ctx, meta, undefined)
            const summary = await summarizeCold(
              ctx,
              persistence,
              meta,
              projections?.values.sessionListMetadata,
              coldBlankProbeMaxBytes,
              signal,
            )
            const attachedSession = ctx.sessions.get(meta.id)
            if (attachedSession !== undefined) return summarizeAttached(attachedSession)
            return {
              ...summary,
              ...projections === undefined ? {} : { projections },
            }
          }),
        )
        const summaries: SessionSummary[] = []
        let rejected = false
        let failure: unknown
        for (const result of settled) {
          if (result.status === 'fulfilled') {
            summaries.push(result.value)
          } else if (!rejected) {
            rejected = true
            failure = result.reason
          }
        }
        if (rejected) throw failure
        signal?.throwIfAborted()
        items.push(...summaries)
      }
    }
    items.sort((a, b) => b.updatedAt - a.updatedAt)
    return items
  }

  /**
   * Resolve the goal service THIS agent runs.
   *
   * The service is per session: an agent preset mounts it behind an `isolate`
   * realm, which no host context resolves. Reading it from the root would
   * answer "absent" for a session whose composition mounts it — so the lookup
   * is keyed by the agent, and only a deployment composing it nowhere is
   * genuinely absent.
   */
  function goalServiceFor(agent: Agent): NonNullable<ReturnType<typeof ctx.get<'goals'>>> | { error: RpcError } {
    const presets = ctx.get('agentPresets')
    const goals = presets?.serviceFor(agent, 'goals') ?? ctx.get('goals')
    if (goals === undefined) {
      return { error: { code: 'internal', message: 'goal service is absent: neither this session\'s agent preset nor the host composition mounts @deepseek-ai/dsh-goal', details: {} } }
    }
    return goals
  }

  /** Map one goal-domain rejection to the wire error (stable GoalError codes ride in details). */
  function goalError(request: RpcRequest<unknown>, error: unknown): RpcResponse<never> {
    const details = error instanceof GoalError ? { goalCode: error.code } : {}
    return err(request, { code: 'internal', message: String(error), details })
  }

  /** Resolve a session's agent, apply one goal mutation, and acknowledge with the new CAS ref. */
  async function mutateGoal(
    request: RpcRequest<{ sessionId: SessionId }>,
    mutation: (goals: NonNullable<ReturnType<typeof ctx.get<'goals'>>>, agent: Agent) => CoreGoalRef,
  ): Promise<RpcResponse<{ ref: GoalRef }>> {
    const denied = await authorizeSession(request, request.payload.sessionId)
    if (denied !== undefined) return err(request, denied)
    const found = await agentFor(request.payload.sessionId)
    if ('error' in found) return err(request, found.error)
    const goals = goalServiceFor(found.agent)
    if ('error' in goals) return err(request, goals.error)
    try {
      const ref = mutation(goals, found.agent)
      return ok(request, { ref: { id: ref.id, revision: ref.revision } })
    } catch (error: unknown) {
      return goalError(request, error)
    }
  }

  /**
   * Whether an adapter currently serves this provider, and therefore whether
   * a session selecting it can start a turn. Catalog membership cannot answer
   * it: an adapter may serve a model its own catalog stopped advertising, so
   * a provider missing from the groups is not the same as one nothing serves.
   * A composition with no llm registry at all cannot judge and says yes —
   * the dispatch it would have refused fails on its own terms.
   */
  function routeServed(provider: string): boolean {
    const llm = ctx.get('llm')
    return llm === undefined || llm.listProviders().some(entry => entry.id === provider)
  }

  /** Return the active custom-model rows visible to this session owner. */
  async function customModelsFor(agent: Agent): Promise<StoredCustomModelView[]> {
    const ownerId = agent.session.header.ownerId
    const service = ctx.get('userModelKeys')
    if (ownerId === undefined || service === undefined) return []
    const rows = await service.listCustom({ userId: ownerId as never })
    return rows.filter(row => row.revoked === null)
  }

  /** Check one opaque custom-model id against the addressed session owner. */
  async function customModelAvailable(agent: Agent, customModelId: string): Promise<boolean> {
    const rows = await customModelsFor(agent)
    return rows.some(row => row.customModelId === customModelId)
  }

  /**
   * Resolve the addressed agent for a turn-starting method and refuse when no
   * adapter serves its current selection: a provider nothing serves cannot start a
   * turn, and letting it try spends the whole pre-step path to fail inside
   * the adapter with a message about registration. Refusing here names the
   * model the session is pointed at while the draft is still in the composer.
   * This is `session.prompt`'s enforcement boundary: a client that disables
   * its input is an affordance, and the method stays callable regardless.
   */
  async function turnAgentFor<T>(
    request: RpcRequest<unknown>, sessionId: SessionId,
  ): Promise<{ agent: Agent } | { refused: RpcResponse<T> }> {
    const found = await agentFor(sessionId)
    if ('error' in found) return { refused: err(request, found.error) }
    const agent = found.agent
    const selection = selectionFor(agent).current
    if (
      selection.provider === CUSTOM_MODEL_PROVIDER_ROUTE
      && !await customModelAvailable(agent, selection.model)
    ) {
      return {
        refused: err(request, {
          code: 'model-unavailable',
          message: 'the selected custom model is unavailable for this account',
          details: { provider: selection.provider, model: selection.model },
        }),
      }
    }
    if (!routeServed(selection.provider)) {
      return {
        refused: err(request, {
          code: 'model-unavailable',
          message: `no adapter serves provider "${selection.provider}"; select a model for this session`,
          details: { provider: selection.provider, model: selection.model },
        }),
      }
    }
    return { agent }
  }

  /** Missing-service report shared by the settings domain (skills-domain stance). */
  function settingsAbsent(): RpcError {
    return { code: 'internal', message: 'settings service is absent: this deployment does not mount a settings provider (e.g. @deepseek-ai/dsh-settings-file) in its composition', details: {} }
  }

  /** Open one Host-resolved target and map native failures onto the wire vocabulary. */
  async function openTarget(
    request: RpcRequest<unknown>, path: string, signal: AbortSignal,
    open: (path: string, signal: AbortSignal) => Promise<void>,
  ): Promise<RpcResponse<{ opened: true }>> {
    try {
      await open(path, signal)
      return ok(request, { opened: true as const })
    } catch (error: unknown) {
      if (signal.aborted) {
        return err(request, {
          code: 'cancelled',
          message: 'path open was aborted',
          details: {},
        })
      }
      return err(request, {
        code: 'internal',
        message: `path open failed: ${error instanceof Error ? error.message : String(error)}`,
        details: {},
      })
    }
  }

  /** Open one Host-resolved path with its default application. */
  function openPath(
    request: RpcRequest<unknown>, path: string, signal: AbortSignal,
  ): Promise<RpcResponse<{ opened: true }>> {
    const open = defaults.openPath
      ?? ((target: string, openSignal: AbortSignal) => openNativePath(target, openSignal))
    return openTarget(request, path, signal, open)
  }

  /** Open one Host-resolved text document in a native editor. */
  function openTextFile(
    request: RpcRequest<unknown>, path: string, signal: AbortSignal,
  ): Promise<RpcResponse<{ opened: true }>> {
    const open = defaults.openTextFile
      ?? ((target: string, openSignal: AbortSignal) => openNativeTextFile(target, openSignal))
    return openTarget(request, path, signal, open)
  }

  /** Whether this deployment can hand a path to a native opener at all. */
  function canOpenPaths(): boolean {
    if (defaults.canOpenPath !== undefined) return defaults.canOpenPath()
    // An injected opener is by definition usable; otherwise ask the platform.
    return defaults.openPath !== undefined || canOpenNativePath()
  }

  /** Missing-service report shared by the credentials domain. */
  function credentialsAbsent(): RpcError {
    return { code: 'internal', message: 'credentials service is absent: this deployment does not mount a credential provider (e.g. @deepseek-ai/dsh-credentials-local) in its composition', details: {} }
  }

  /** Map one redacted settings descriptor to its wire view. */
  function namespaceView(descriptor: SettingsDescriptor): SettingsNamespaceView {
    return {
      ns: String(descriptor.ns),
      schema: descriptor.schema,
      value: descriptor.value,
      ...descriptor.base === undefined ? {} : { base: descriptor.base },
      ...descriptor.user === undefined ? {} : { user: descriptor.user },
      applies: descriptor.applies,
      secrets: (descriptor.secrets ?? []).map(secret => ({ path: [...secret.path], set: secret.set })),
      revision: descriptor.revision,
    }
  }

  /**
   * Run one settings write (merge or wholesale replace) and acknowledge with
   * the namespace's new redacted view. Every seam refusal — unknown or invalid
   * namespace, read-only provider, schema validation, storage — becomes one
   * `settings-rejected` carrying the seam's own message.
   */
  async function settingsWrite(
    request: RpcRequest<unknown>,
    ns: string,
    mode: 'update' | 'replace' | 'mutate',
    section: object,
    expectedRevision?: number,
  ): Promise<RpcResponse<SettingsNamespaceView>> {
    const settings = ctx.get('settings')
    if (settings === undefined) return err(request, settingsAbsent())
    const rejected = (error: unknown): RpcResponse<SettingsNamespaceView> => {
      // A stale writer is its own outcome, not a malformed request: the client
      // must re-read and re-apply rather than treat the write as invalid.
      if (error instanceof SettingsConflictError) {
        return err(request, {
          code: 'settings-conflict',
          message: error.message,
          details: { ns, expected: error.expected, actual: error.actual },
        })
      }
      return err(request, {
        code: 'settings-rejected',
        message: error instanceof Error ? error.message : String(error),
        details: { ns },
      })
    }
    let branded: SettingsNamespace
    try {
      branded = settingsNamespace(ns)
    } catch (error: unknown) {
      // A malformed name can address no registration, so it fails exactly as
      // an unregistered one does.
      return rejected(error)
    }
    try {
      if (mode === 'update') await settings.update(branded, section, expectedRevision)
      else if (mode === 'replace') await settings.replace(branded, section, expectedRevision)
      else await settings.mutate(branded, section as SettingsPathOp[], expectedRevision)
    } catch (error: unknown) {
      return rejected(error)
    }
    const descriptor = settings.describe({ redactSecrets: true }).find(candidate => candidate.ns === branded)
    if (descriptor === undefined) {
      // The write committed but the namespace vanished before this read: only
      // a concurrent registrant disposal can produce it.
      return err(request, { code: 'internal', message: `settings namespace "${ns}" was disposed after the ${mode}`, details: {} })
    }
    return ok(request, namespaceView(descriptor))
  }

  return {
    sessions: {
      // Attached sessions summarize from memory; persisted-but-unattached (cold)
      // sessions merge in from the persistence store so history survives restarts.
      // Logs without a cwd are not served; every session records its project
      // at create time.
      async list(request) {
        return ok(request, { items: await listVisibleSessionSummaries(undefined, requestOwner(request)) })
      },

      async search(request, signal) {
        const cancelled = () => err<{ items: SessionSearchItem[]; hasMore: boolean }>(request, {
          code: 'cancelled',
          message: 'session search was aborted',
          details: {},
        })
        if (isAborted(signal)) return cancelled()
        const sessionQuery = ctx.get('sessionQuery')
        if (sessionQuery === undefined) {
          return err(request, {
            code: 'internal',
            message: 'session search is unavailable: this deployment does not mount @deepseek-ai/dsh-session-query',
            details: {},
          })
        }
        try {
          const visible = await listVisibleSessionSummaries(signal, requestOwner(request))
          if (isAborted(signal)) return cancelled()
          if (visible.length === 0) return ok(request, { items: [], hasMore: false })
          const visibleIds = new Set(visible.map(item => item.sessionId))
          const authorized: SessionSearchItem[] = []
          const acceptedIds = new Set<SessionId>()
          const seenCursors = new Set<SessionSearchCursor>()
          let cursor: SessionSearchCursor | undefined
          let providerCallCount = 0
          let providerPageLimit = SESSION_SEARCH_RESULT_LIMIT
          while (authorized.length <= SESSION_SEARCH_RESULT_LIMIT) {
            if (isAborted(signal)) return cancelled()
            if (providerCallCount >= SESSION_SEARCH_PROVIDER_CALL_LIMIT) {
              throw new Error(
                `session search provider exceeded the ${SESSION_SEARCH_PROVIDER_CALL_LIMIT}-call work budget`,
              )
            }
            providerCallCount++
            const requestedCursor = cursor
            const requestedPageLimit = providerPageLimit
            let page
            try {
              page = await sessionQuery.searchSessions({
                query: request.payload.query,
                eventFilters: [
                  { kind: 'type', values: ['user/message', 'assistant/message'] },
                  { kind: 'surface', values: ['current'] },
                ],
                limit: requestedPageLimit,
                ...requestedCursor === undefined ? {} : { cursor: requestedCursor },
              }, { signal })
            } catch (error: unknown) {
              if (isAborted(signal)) return cancelled()
              if (
                requestedCursor === undefined
                && error instanceof SessionQueryError
                && error.code === 'SESSION_QUERY_INVALID_LIMIT'
                && requestedPageLimit > 1
              ) {
                providerPageLimit = Math.max(1, Math.floor(requestedPageLimit / 2))
                continue
              }
              if (
                requestedCursor !== undefined
                && error instanceof SessionQueryError
                && error.code === 'SESSION_QUERY_STALE_CURSOR'
              ) {
                authorized.length = 0
                acceptedIds.clear()
                seenCursors.clear()
                cursor = undefined
                continue
              }
              throw error
            }
            if (isAborted(signal)) return cancelled()
            const providerItemCount = page.items.length
            if (providerItemCount > requestedPageLimit) {
              throw new Error(
                `session search provider returned ${providerItemCount} items; maximum is ${requestedPageLimit}`,
              )
            }
            // Host visibility is the authorization boundary. Consume the
            // provider's globally ranked results rather than binding every
            // visible id into one SQLite statement, then require each hit to
            // name a visible session and a current message from that same
            // session before emitting its snippet.
            for (const hit of page.items) {
              if (authorized.length > SESSION_SEARCH_RESULT_LIMIT) continue
              if (
                !visibleIds.has(hit.header.id)
                || hit.bestMatch.sessionId !== hit.header.id
                || hit.bestMatch.surface !== 'current'
                || !MESSAGE_TYPES.has(hit.bestMatch.type)
                || acceptedIds.has(hit.header.id)
              ) continue
              const snippet = truncateUnicodeCodePoints(
                hit.bestMatch.snippet,
                SESSION_SEARCH_SNIPPET_MAX_CODE_POINTS,
              )
              acceptedIds.add(hit.header.id)
              authorized.push({
                sessionId: hit.header.id,
                snippet,
              })
            }
            const nextCursor = page.nextCursor
            if (nextCursor !== undefined) {
              if (seenCursors.has(nextCursor)) {
                throw new Error('session search provider repeated a continuation cursor')
              }
              seenCursors.add(nextCursor)
            }
            if (authorized.length > SESSION_SEARCH_RESULT_LIMIT || nextCursor === undefined) break
            cursor = nextCursor
          }
          return ok(request, {
            items: authorized.slice(0, SESSION_SEARCH_RESULT_LIMIT),
            hasMore: authorized.length > SESSION_SEARCH_RESULT_LIMIT,
          })
        } catch (error: unknown) {
          if (
            isAborted(signal)
            || (error instanceof SessionQueryError && error.code === 'SESSION_QUERY_ABORTED')
          ) return cancelled()
          // XXX: Redact provider details before exposing this gateway beyond
          // its current single-user local deployment.
          return err(request, {
            code: 'internal',
            message: `session search failed: ${String(error)}`,
            details: {},
          })
        }
      },

      async create(request) {
        const sessionId = request.payload.sessionId ?? `session-${randomUUID()}` as SessionId
        const owner = requestOwner(request)
        if (owner !== undefined && request.payload.cwd !== undefined) {
          return err(request, { code: 'bad-request', message: 'account session.create must not provide cwd', details: { issues: [] } })
        }
        const accountPreset = defaults.accountAgentPreset
        if (owner !== undefined && accountPreset === undefined) {
          return err(request, { code: 'bad-request', message: 'account agent preset is not configured', details: { issues: [] } })
        }
        if (owner !== undefined && request.payload.agentPreset !== undefined && request.payload.agentPreset !== accountPreset) {
          return err(request, { code: 'bad-request', message: `account sessions may use only the ${accountPreset} preset`, details: { issues: [] } })
        }
        if (owner !== undefined && ctx.get('agentPresets') === undefined) {
          return err(request, { code: 'bad-request', message: 'account agent preset roster is not configured', details: { issues: [] } })
        }
        if (owner !== undefined && request.payload.sessionId !== undefined) {
          try {
            const existing = await readSessionState(sessionId)
            if (existing.header.ownerId !== owner) return sessionNotFound(request, sessionId)
          } catch (error: unknown) {
            if (!(error instanceof SessionNotFound)) throw error
          }
        }
        let workspace: Workspace | undefined
        if (request.payload.workspaceId !== undefined) {
          workspace = ctx.workspaceRegistry.get(brandWorkspaceId(request.payload.workspaceId), owner === undefined ? { kind: 'local' } : { kind: 'account', userId: owner })
          if (workspace === undefined) {
            return err(request, {
              code: 'workspace-not-found',
              message: `workspace "${request.payload.workspaceId}" not found`,
              details: { workspaceId: request.payload.workspaceId },
            })
          }
          if (owner !== undefined) {
            try {
              await accountPath(request, workspace.path)
            } catch {
              return err(request, {
                code: 'workspace-not-found',
                message: `workspace "${request.payload.workspaceId}" not found`,
                details: { workspaceId: request.payload.workspaceId },
              })
            }
          }
        }
        if (owner !== undefined && workspace === undefined) {
          const root = await accountRoot(owner)
          const ensured = await ensureWorkspace(root, { kind: 'account', userId: owner })
          workspace = ensured.workspace
        }
        const cwd = workspace?.path ?? (owner === undefined ? request.payload.cwd ?? defaults.cwd : await accountRoot(owner))
        // Account creation requires a deployment-owned roster so the configured
        // safe preset is resolved and recorded with the session.
        const requestedPreset = owner === undefined ? request.payload.agentPreset : accountPreset
        try {
          await ensureSession(sessionId, cwd, request.payload.sessionId !== undefined, requestedPreset, owner)
        } catch (error: unknown) {
          if (error instanceof AgentPresetConflict) {
            return err(request, {
              code: 'agent-preset-conflict',
              message: error.message,
              details: {
                sessionId: error.sessionId,
                requestedPreset: error.requestedPreset,
                ...error.existingPreset === undefined ? {} : { existingPreset: error.existingPreset },
              },
            })
          }
          const refused = presetFailure(request, error)
          if (refused !== undefined) return refused
          if (error instanceof SessionCwdConflict) {
            return err(request, {
              code: 'session-conflict',
              message: error.message,
              details: {
                sessionId: error.sessionId,
                requestedCwd: error.requestedCwd,
                ...error.existingCwd === undefined ? {} : { existingCwd: error.existingCwd },
              },
            })
          }
          if (error instanceof SubagentSessionOwnership) {
            return err(request, subagentOwnershipError(error.sessionId))
          }
          if (owner !== undefined && error instanceof Error && error.message.includes('owned by another account')) {
            return sessionNotFound(request, sessionId)
          }
          return err(request, {
            code: 'internal',
            message: `failed to create session "${sessionId}": ${String(error)}`,
            details: {},
          })
        }
        if (workspace !== undefined) {
          try {
            await workspace.attachSession(sessionId)
          } catch (error: unknown) {
            return err(request, {
              code: 'workspace-attach-failed',
              message: `session "${sessionId}" was created but could not attach to workspace "${workspace.id}": ${String(error)}`,
              details: { sessionId, workspaceId: workspace.id },
            })
          }
        }
        // Echo the composition the session RUNS so a client can label it
        // without waiting for the next list refresh — the create is the commit
        // point that knows it (a caller that named none gets the default).
        // Resolved from the log for the same reason `sessionListFields()` is:
        // this handler also adopts an already-live session, and one that
        // switched while blank runs a preset its header no longer names, so
        // echoing the header would contradict both the adoption this call just
        // allowed and the row `session.list` serves for the same session.
        const created = ctx.agents.get(sessionId)
        const createdPreset = created === undefined ? undefined : resolveSessionPreset(created.session)
        return ok(request, { sessionId, ...createdPreset === undefined ? {} : { agentPreset: createdPreset } })
      },

      async history(request) {
        const { sessionId, beforeSeq, maxMessages } = request.payload
        try {
          const denied = await authorizeSession(request, sessionId)
          if (denied !== undefined) return err(request, denied)
          const source = await historySourceFor(sessionId)
          // Both awaits happen BEFORE the cut. Ensuring the recorded
          // composition's standing mount is what registers its projection
          // units, so a first cold read would otherwise serve a baseline
          // missing every preset-owned key; and an attached session keeps
          // appending, so awaiting between the two reads would pair events cut
          // at N with a baseline folded to N+1.
          const scope = await presenterScopeFor(sessionId, sourceSession(source))
          const cut = historyCutOf(source, beforeSeq === undefined)
          const page = historyPage(ctx, cut.events, beforeSeq, maxMessages, scope)
          return ok(request, {
            events: page.events,
            hasMore: page.hasMore,
            ...cut.projections === undefined ? {} : { projections: cut.projections },
          })
        } catch (error: unknown) {
          if (error instanceof SessionNotFound) {
            return err(request, { code: 'session-not-found', message: error.message, details: { sessionId } })
          }
          return err(request, {
            code: 'internal',
            message: `history unavailable for session "${sessionId}": ${String(error)}`,
            details: {},
          })
        }
      },

      async models(request) {
        const { sessionId } = request.payload
        const denied = await authorizeSession(request, sessionId)
        if (denied !== undefined) return err(request, denied)
        const found = await agentFor(sessionId)
        if ('error' in found) return err(request, found.error)
        const current = selectionFor(found.agent).current
        const { groups, failures } = await buildModelCatalog(ctx)
        const customModels = await customModelsFor(found.agent)
        if (customModels.length > 0) {
          groups.push({
            id: CUSTOM_MODEL_PROVIDER_ROUTE,
            name: 'Custom models',
            models: customModels.map(model => ({ id: model.customModelId, name: model.label })),
          })
        }
        const routable = routeServed(current.provider)
          && (current.provider !== CUSTOM_MODEL_PROVIDER_ROUTE
            || customModels.some(model => model.customModelId === current.model))
        return ok(request, { current: { ...current }, routable, groups, failures })
      },

      async selectModel(request) {
        const { sessionId, provider, model, reasoningEffort } = request.payload
        const denied = await authorizeSession(request, sessionId)
        if (denied !== undefined) return err(request, denied)
        const found = await agentFor(sessionId)
        if ('error' in found) return err(request, found.error)
        return serializeImageAdmission(found.agent, async () => {
          try {
            if (
              provider === CUSTOM_MODEL_PROVIDER_ROUTE
              && !await customModelAvailable(found.agent, model)
            ) {
              throw new Error('custom model is unavailable for this account')
            }
            const resolved = await ctx.llm.resolveCallConfig({
              provider,
              model,
              ...reasoningEffort === undefined
                ? {}
                : { reasoningEffort: ReasoningEffortId(reasoningEffort) },
            })
            const selected: ModelSelection = {
              provider: resolved.provider,
              model: resolved.model,
              ...resolved.reasoningEffort === undefined
                ? {}
                : { reasoningEffort: resolved.reasoningEffort },
            }
            selectionFor(found.agent).current = selected
            if (selected.provider !== CUSTOM_MODEL_PROVIDER_ROUTE) {
              try {
                await defaults.saveDefaultModelSelection?.(selected)
              } catch (error: unknown) {
                ctx.logger.warn(
                  `api-proxy: the model switch applies to this session but was not saved as the default: ${String(error)}`,
                )
              }
            }
            return ok(request, { selected: { ...selected } })
          } catch (error: unknown) {
            return err(request, {
              code: 'model-unavailable',
              message: error instanceof Error ? error.message : String(error),
              details: { provider, model },
            })
          }
        })
      },

      async rename(request) {
        const { sessionId, title } = request.payload
        const denied = await authorizeSession(request, sessionId)
        if (denied !== undefined) return err(request, denied)
        const found = await agentFor(sessionId)
        if ('error' in found) return err(request, found.error)
        const titles = ctx.get('sessionTitle')
        if (titles === undefined) {
          return err(request, { code: 'internal', message: 'renaming is unavailable: this deployment mounts no session-title service', details: {} })
        }
        try {
          const accepted = titles.rename(found.agent.session, title)
          return ok(request, { title: accepted.title, seq: accepted.eventSeq })
        } catch (error: unknown) {
          // Only the input's fault maps to title-invalid (the message is
          // product-user-visible in the rename dialog); liveness and disposal
          // races are deployment trouble, not a bad title.
          if (error instanceof SessionTitleInvalidError) {
            return err(request, {
              code: 'title-invalid',
              message: error.message,
              details: { sessionId },
            })
          }
          return err(request, {
            code: 'internal',
            message: `failed to rename session "${sessionId}": ${String(error)}`,
            details: {},
          })
        }
      },

      async fork(request) {
        const { sessionId, atSeq } = request.payload
        const denied = await authorizeSession(request, sessionId)
        if (denied !== undefined) return err(request, denied)
        let source: SessionReadState
        try {
          source = await readSessionState(sessionId)
        } catch (error: unknown) {
          if (error instanceof SessionNotFound) {
            return err(request, { code: 'session-not-found', message: error.message, details: { sessionId } })
          }
          return err(request, {
            code: 'internal',
            message: `fork source unavailable for session "${sessionId}": ${String(error)}`,
            details: {},
          })
        }
        const events = source.events
        // An in-log anchor belongs to the turn containing it and must never
        // clip backward to an earlier completed turn. Omitted and past-end
        // anchors retain the last-completed-turn shortcut.
        const lastSeq = events.at(-1)?.seq ?? -1
        const anchoredBoundary = atSeq === undefined
          ? undefined
          : events.find(e => e.type === 'turn/end' && e.seq >= atSeq)
        const boundary = anchoredBoundary
          ?? (atSeq === undefined || atSeq > lastSeq
            ? events.findLast(e => e.type === 'turn/end')
            : undefined)
        if (boundary === undefined) {
          return err(request, {
            code: 'fork-unavailable',
            message: atSeq !== undefined && atSeq <= lastSeq
              ? `session "${sessionId}" has not completed the turn containing event ${String(atSeq)}`
              : `session "${sessionId}" has no completed turn to fork from`,
            details: { sessionId },
          })
        }
        // Extend the cut through trailing out-of-band appends (session/title,
        // injections) up to the next turn/start: they are standalone events, so
        // the seed stays balanced, and the child inherits a title generated
        // right after the boundary turn.
        let cut = boundary.seq + 1
        while (cut < events.length && events[cut]?.type !== 'turn/start') cut++
        let workspace: Workspace | undefined
        try {
          workspace = await forkWorkspace(source)
        } catch (error: unknown) {
          return err(request, {
            code: 'internal',
            message: `failed to resolve fork workspace for session "${sessionId}": ${String(error)}`,
            details: {},
          })
        }
        const childId = `session-${randomUUID()}` as SessionId
        // The child inherits the parent's composition for the same reason a
        // resumed session keeps its own: the seeded history was produced under
        // those tools, and composing anything else would strand the tool calls
        // it already carries. Now that no model-facing row sits in the host
        // plane, composing nothing would leave the child with no tools at all.
        const forkOwner = requestOwner(request)
        const forkComposition = await composeAgent(
          resolveSessionPreset(source),
          forkOwner === undefined ? undefined : String(forkOwner),
          undefined,
          events,
        )
        try {
          await ctx.agents.create({
            sessionId: childId,
            seed: events.slice(0, cut),
            meta: {
              ...source.header.cwd === undefined ? {} : { cwd: source.header.cwd },
              parentSession: source.id,
              seedLength: cut,
              ...requestOwner(request) === undefined ? {} : { ownerId: requestOwner(request) },
              ...forkComposition.agentPreset === undefined
                ? {}
                : { agentPreset: forkComposition.agentPreset },
            },
            agentOptions: agentOptions(),
            setup: forkComposition.setup,
          })
        } catch (error: unknown) {
          return err(request, {
            code: 'internal',
            message: `failed to fork session "${sessionId}": ${String(error)}`,
            details: {},
          })
        }
        // An ordinary source keeps its direct Workspace. A subagent source is
        // not listed there, so its ordinary fork joins the nearest owning
        // ancestor instead. The child is already published if attach fails.
        if (workspace !== undefined) {
          try {
            await workspace.attachSession(childId)
          } catch (error: unknown) {
            return err(request, {
              code: 'workspace-attach-failed',
              message: `session "${childId}" was forked but could not attach to workspace "${workspace.id}": ${String(error)}`,
              details: { sessionId: childId, workspaceId: workspace.id },
            })
          }
        }
        return ok(request, { sessionId: childId })
      },

      async prompt(request) {
        const { sessionId, mode, content, clientTimeZone } = request.payload
        const denied = await authorizeSession(request, sessionId)
        if (denied !== undefined) return err(request, denied)
        const canonicalTimeZone = clientTimeZone === undefined
          ? undefined
          : canonicalClientTimeZone(clientTimeZone)
        if (clientTimeZone !== undefined && canonicalTimeZone === undefined) {
          return err(request, {
            code: 'invalid-time-zone',
            message: 'clientTimeZone must be UTC or a valid IANA Area/Location name',
            details: { value: clientTimeZone },
          })
        }
        const resolved = await turnAgentFor<{ accepted: true }>(request, sessionId)
        if ('refused' in resolved) return resolved.refused
        const agent = resolved.agent
        // Request identity and optional browser zone ride the exact durable user message.
        let source: MessageSource = {
          kind: 'user',
          rpcId: request.rpcId,
          ...(canonicalTimeZone === undefined ? {} : { clientTimeZone: canonicalTimeZone }),
        }
        const hasImage = content.some(part => part.type === 'image')
        const admit = async (): Promise<RpcResponse<{ accepted: true }>> => {
          try {
            if (hasImage) {
              const current = selectionFor(agent).current
              const modelInfo = await ctx.llm.resolveModelInfo(current.provider, current.model)
              if (modelInfo.inputModalities !== undefined && !modelInfo.inputModalities.includes('image')) {
                return err(request, {
                  code: 'attachment-error',
                  message: `Model "${current.model}" does not support image input.`,
                  details: { reason: 'MODEL_DOES_NOT_SUPPORT_IMAGES' },
                })
              }
            }
            const durable = await durablePromptContent(ctx, content)
            if (durable.files.length > 0) source = { ...source, files: durable.files } as MessageSource
            const message: UserMessage = createUserMessage({ content: durable.blocks, source })
            if (mode === 'steer') agent.steer(message)
            else agent.followup(message)
          } catch (error: unknown) {
            if (error instanceof AttachmentError) {
              return err(request, {
                code: 'attachment-error',
                message: error.message,
                details: { reason: error.code },
              })
            }
            return err(request, {
              code: 'agent-busy',
              message: 'prompt rejected',
              details: { reason: String(error) },
            })
          }
          return ok(request, { accepted: true as const })
        }
        return hasImage ? serializeImageAdmission(agent, admit) : admit()
      },

      async attachment(request) {
        const { sessionId, attachmentId } = request.payload
        const denied = await authorizeSession(request, sessionId)
        if (denied !== undefined) return err(request, denied)
        let state: SessionReadState
        try {
          state = await readSessionState(sessionId)
        } catch (error: unknown) {
          if (error instanceof SessionNotFound) {
            return err(request, {
              code: 'session-not-found',
              message: error.message,
              details: { sessionId },
            })
          }
          return err(request, {
            code: 'internal',
            message: `attachment authorization unavailable for session "${sessionId}": ${String(error)}`,
            details: {},
          })
        }
        const ref = referencedImage(state.events, String(attachmentId))
        if (ref === undefined) {
          return err(request, {
            code: 'attachment-error',
            message: 'Image is not referenced by this session.',
            details: { reason: 'ATTACHMENT_NOT_REFERENCED' },
          })
        }
        try {
          const stored = await ctx.attachments.readImage(ref)
          return ok(request, {
            attachment: stored.ref,
            data: Buffer.from(stored.data).toString('base64'),
          })
        } catch (error: unknown) {
          if (error instanceof AttachmentError) {
            return err(request, {
              code: 'attachment-error',
              message: error.message,
              details: { reason: error.code },
            })
          }
          return err(request, {
            code: 'internal',
            message: 'Unable to read image attachment.',
            details: {},
          })
        }
      },

      async updateQueue(request) {
        const { sessionId, itemId, action } = request.payload
        const denied = await authorizeSession(request, sessionId)
        if (denied !== undefined) return err(request, denied)
        if (action.kind === 'edit' && action.content.some(block => block.type !== 'text')) {
          return Promise.resolve(err(request, {
            code: 'attachment-error',
            message: 'queue edits accept text content only',
            details: { reason: 'QUEUE_EDIT_NON_TEXT' },
          }))
        }
        const agent = ctx.agents.get(sessionId)
        if (agent !== undefined && hasSubagentOwner(agent.session, agent)) {
          return Promise.resolve(err(request, subagentOwnershipError(sessionId)))
        }
        if (agent === undefined) {
          return Promise.resolve(err(request, {
            code: 'queue-item-not-found',
            message: 'queued item is no longer pending',
            details: { itemId },
          }))
        }
        const target = agent.inbox.nextTurn.some(message => message.id === itemId)
          ? 'next-turn'
          : agent.inbox.nextStep.some(message => message.id === itemId) ? 'next-step' : undefined
        const message = target === undefined
          ? undefined
          : (target === 'next-turn' ? agent.inbox.nextTurn : agent.inbox.nextStep)
            .find(candidate => candidate.id === itemId)
        if (target === undefined || message === undefined) {
          return Promise.resolve(err(request, {
            code: 'queue-item-not-found',
            message: 'queued item is no longer pending',
            details: { itemId },
          }))
        }
        if (action.kind === 'steer' && (target !== 'next-turn' || agent.status !== 'running')) {
          return Promise.resolve(err(request, {
            code: 'steer-unavailable',
            message: 'current turn no longer accepts steering',
            details: { itemId },
          }))
        }
        if (action.kind === 'edit') {
          agent.inbox.replace(itemId, freezeMessage({ ...message, content: action.content }))
        } else {
          agent.inbox.remove(itemId)
          if (action.kind === 'steer') agent.steer(message)
        }
        return Promise.resolve(ok(request, { accepted: true as const }))
      },

      async cancel(request) {
        const { sessionId } = request.payload
        const denied = await authorizeSession(request, sessionId)
        if (denied !== undefined) return err(request, denied)
        const agent = ctx.agents.get(sessionId)
        if (agent === undefined) {
          return Promise.resolve(err(request, {
            code: 'session-not-found',
            message: `session "${sessionId}" not found (not attached)`,
            details: { sessionId },
          }))
        }
        if (hasSubagentOwner(agent.session, agent)) {
          return Promise.resolve(err(request, subagentOwnershipError(sessionId)))
        }
        agent.cancel({ kind: 'user' }, { keepInbox: true })
        return Promise.resolve(ok(request, { accepted: true as const }))
      },
    },

    subagents: {
      async list(request, signal) {
        const denied = await authorizeSession(request, request.payload.parentSessionId)
        if (denied !== undefined) return err(request, denied)
        try {
          const entries = await ctx.subagents.listChildren(request.payload.parentSessionId, signal)
          return ok(request, {
            entries: entries.map(entry => entry.kind === 'child'
              ? {
                ...entry,
                activity: ctx.agents.get(entry.id)?.status === 'running' ? 'running' : 'inactive',
              }
              : entry),
            parentAvailable: ctx.agents.get(request.payload.parentSessionId) !== undefined,
          })
        } catch (error: unknown) {
          if (signal?.aborted || (error instanceof SubagentError && error.code === 'CANCELLED')) {
            return err(request, {
              code: 'cancelled',
              message: 'subagent catalog read was cancelled',
              details: {},
            })
          }
          if (error instanceof SubagentError && error.code === 'SUBAGENT_CONTROL_PROJECTIONS_UNAVAILABLE') {
            return err(request, projectionsUnavailableError())
          }
          return err(request, {
            code: 'internal',
            message: 'subagent catalog read failed',
            details: {},
          })
        }
      },

      async history(request, signal) {
        const {
          parentSessionId, childSessionId, mode, beforeSeq, maxMessages,
        } = request.payload
        const parentDenied = await authorizeSession(request, parentSessionId)
        if (parentDenied !== undefined) return err(request, parentDenied)
        const childDenied = await authorizeSession(request, childSessionId)
        if (childDenied !== undefined) return err(request, childDenied)
        const verified = await catalogChild(ctx, {
          parentSessionId, childSessionId, mode,
        }, signal)
        if (verified.error !== undefined) return err(request, verified.error)
        // The generic-history data plane: an attached child serves its
        // in-memory snapshot and the registry's live watermark projections; a
        // cold child is one persistence inspection plus a detached fold.
        let header: SessionHeader
        let events: SessionEvent[]
        let projections: SessionProjectionsBlock | undefined
        const attached = ctx.sessions.get(childSessionId)
        if (attached !== undefined) {
          header = attached.header
          events = [...attached.events]
          projections = beforeSeq === undefined
            ? subagentHistoryProjections(ctx, childSessionId, () => projectionsFor(ctx, attached))
            : undefined
        } else {
          try {
            const inspected = await inspectServable(childSessionId)
            header = inspected.meta
            events = inspected.events
            projections = beforeSeq === undefined
              ? subagentHistoryProjections(ctx, childSessionId, () => detachedProjectionsFor(ctx, inspected.events))
              : undefined
          } catch (error: unknown) {
            if (signal?.aborted) {
              return err(request, {
                code: 'cancelled',
                message: 'subagent history read was cancelled',
                details: {},
              })
            }
            if (error instanceof SessionNotFound) {
              return err(request, {
                code: 'subagent-not-found',
                message: 'subagent disappeared during history read',
                details: { parentSessionId, childSessionId },
              })
            }
            return err(request, {
              code: 'internal',
              message: 'subagent history read failed',
              details: {},
            })
          }
        }
        if (signal?.aborted) {
          return err(request, {
            code: 'cancelled',
            message: 'subagent history read was cancelled',
            details: {},
          })
        }
        if (header.parentSession !== parentSessionId) {
          return err(request, {
            code: 'subagent-unauthorized',
            message: 'subagent parent changed during history read',
            details: { childSessionId },
          })
        }
        const page = historyPage(ctx, events, beforeSeq, maxMessages)
        return ok(request, { ...page, ...projections === undefined ? {} : { projections } })
      },

      async prompt(request, signal) {
        const { parentSessionId, childSessionId, content, clientTimeZone } = request.payload
        const parentDenied = await authorizeSession(request, parentSessionId)
        if (parentDenied !== undefined) return err(request, parentDenied)
        const childDenied = await authorizeSession(request, childSessionId)
        if (childDenied !== undefined) return err(request, childDenied)
        const canonicalTimeZone = clientTimeZone === undefined
          ? undefined
          : canonicalClientTimeZone(clientTimeZone)
        if (clientTimeZone !== undefined && canonicalTimeZone === undefined) {
          return err(request, {
            code: 'invalid-time-zone',
            message: 'clientTimeZone must be UTC or a valid IANA Area/Location name',
            details: { value: clientTimeZone },
          })
        }
        const parent = ctx.agents.get(parentSessionId)
        if (parent === undefined) {
          return err(request, {
            code: 'subagent-parent-unavailable',
            message: `parent session "${parentSessionId}" is not live`,
            details: { parentSessionId },
          })
        }
        const verified = await catalogChild(ctx, {
          parentSessionId, childSessionId, mode: 'continuable',
        }, signal)
        if (verified.error !== undefined) return err(request, verified.error)
        try {
          const messageId = await ctx.subagents.followup(parent, childSessionId, content, {
            source: {
              kind: 'user',
              rpcId: request.rpcId,
              ...(canonicalTimeZone === undefined ? {} : { clientTimeZone: canonicalTimeZone }),
            },
            signal,
          })
          return ok(request, { messageId })
        } catch (error: unknown) {
          return subagentPromptError(request, error, signal)
        }
      },

      // Deliberately no catalog, history, persistence, or parent Agent lookup:
      // the core primitive alone authorizes the durable address against the
      // live Activation, which is what keeps a live child interruptible while
      // its parent Agent is offline. Absent targets are accepted no-ops there.
      async interrupt(request) {
        const { parentSessionId, childSessionId } = request.payload
        const denied = await authorizeSession(request, childSessionId)
        if (denied !== undefined) return err(request, denied)
        try {
          ctx.subagents.interrupt(childSessionId, { kind: 'user', parentSessionId })
        } catch (error: unknown) {
          if (error instanceof SubagentError && error.code === 'UNAUTHORIZED') {
            return Promise.resolve(err(request, {
              code: 'subagent-unauthorized',
              message: 'subagent does not belong to this parent',
              details: { childSessionId },
            }))
          }
          return Promise.resolve(err(request, {
            code: 'internal',
            message: 'subagent interrupt failed',
            details: {},
          }))
        }
        return Promise.resolve(ok(request, { accepted: true as const }))
      },
    },

    workspace: {
      list(request) {
        const owner = requestOwner(request)
        const access = owner === undefined ? { kind: 'local' as const } : { kind: 'account' as const, userId: owner }
        const visible = (workspace: Workspace): WorkspaceView | undefined => {
          const sessionIds = [...workspace.sessionIds]
          return { ...workspaceView(workspace), sessionIds }
        }
        return Promise.resolve(ok(request, {
          items: ctx.workspaceRegistry.list(access).map(visible).filter((value): value is WorkspaceView => value !== undefined),
          archivedSessionIds: [...ctx.workspaceRegistry.archivedSessionIdsFor(access)],
        }))
      },

      async create(request) {
        const { path } = request.payload
        try {
          const owner = requestOwner(request)
          const checked = owner === undefined ? path : (await accountPath(request, path))?.path as string
          const access = owner === undefined ? { kind: 'local' as const } : { kind: 'account' as const, userId: owner }
          const { workspace, created } = await ensureWorkspace(checked, access)
          return ok(request, { workspace: workspaceView(workspace), created })
        } catch (error: unknown) {
          // The registry rejects a path that does not resolve to an existing
          // directory (realpath ENOENT / not-a-directory) — the business
          // error of the typed-path flow, surfaced as a validation failure.
          return err(request, {
            code: 'workspace-invalid-path',
            message: `cannot create a workspace at "${path}": ${error instanceof Error ? error.message : String(error)}`,
            details: { path },
          })
        }
      },

      async importDirectory(request) {
        const owner = requestOwner(request)
        if (owner === undefined) return err(request, { code: 'bad-request', message: 'directory import requires an authenticated account', details: { issues: [] } })
        const { importId, title, files } = request.payload
        const key = `${String(owner)}:${importId}`
        const existing = importedDirectories.get(key)
        if (existing !== undefined) return ok(request, { workspace: workspaceView(existing), created: false })
        if (files.length > DIRECTORY_IMPORT_MAX_FILES) return err(request, { code: 'bad-request', message: 'directory contains too many files', details: { issues: [] } })
        let total = 0
        const seenPaths = new Set<string>()
        for (const file of files) {
          const parts = file.path.split('/')
          if (file.path.includes('\0') || isAbsolute(file.path) || file.path.includes('\\') || parts.some(part => part === '' || part === '.' || part === '..')) return err(request, { code: 'bad-request', message: `invalid relative path: ${file.path}`, details: { issues: [] } })
          if (file.content.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.content)) return err(request, { code: 'bad-request', message: 'file content is not base64', details: { issues: [] } })
          const decoded = Buffer.from(file.content, 'base64')
          if (decoded.toString('base64') !== file.content) return err(request, { code: 'bad-request', message: 'file content is not canonical base64', details: { issues: [] } })
          const size = decoded.byteLength
          if (size > DIRECTORY_IMPORT_MAX_FILE_BYTES) return err(request, { code: 'bad-request', message: `file exceeds ${DIRECTORY_IMPORT_MAX_FILE_BYTES} bytes`, details: { issues: [] } })
          if (seenPaths.has(file.path)) return err(request, { code: 'bad-request', message: `duplicate relative path: ${file.path}`, details: { issues: [] } })
          seenPaths.add(file.path)
          total += size
        }
        if (total > DIRECTORY_IMPORT_MAX_TOTAL_BYTES) return err(request, { code: 'bad-request', message: `directory exceeds ${DIRECTORY_IMPORT_MAX_TOTAL_BYTES} bytes`, details: { issues: [] } })
        const displayTitle = `${title.trim()}（导入副本）`
        let staging: string | undefined
        let published: string | undefined
        let publishedByRequest = false
        try {
          const root = (await accountRoot(owner))
          const imports = join(root, 'imports')
          await mkdir(imports, { recursive: true, mode: 0o700 })
          staging = join(imports, `.staging-${importId}-${randomUUID()}`)
          published = join(imports, importId)
          await mkdir(staging, { recursive: true, mode: 0o700 })
          for (const file of files) {
            const target = join(staging, file.path)
            await mkdir(dirname(target), { recursive: true, mode: 0o700 })
            await writeFile(target, Buffer.from(file.content, 'base64'), { mode: 0o600, flag: 'wx' })
          }
          try {
            await rename(staging, published)
            publishedByRequest = true
            staging = undefined
          } catch (error) {
            const code = (error as NodeJS.ErrnoException).code
            if (code === 'EEXIST' || code === 'ENOTEMPTY') {
              const found = await ensureWorkspace(published, { kind: 'account', userId: owner }, displayTitle)
              importedDirectories.set(key, found.workspace)
              return ok(request, { workspace: workspaceView(found.workspace), created: false })
            }
            throw error
          }
          const ensured = await ensureWorkspace(published, { kind: 'account', userId: owner }, displayTitle)
          const workspace = ensured.workspace
          importedDirectories.set(key, workspace)
          return ok(request, { workspace: workspaceView(workspace), created: true })
        } catch (error) {
          if (publishedByRequest && published !== undefined) await rm(published, { recursive: true, force: true }).catch(() => undefined)
          ctx.logger.error(`workspace import ${importId} failed: ${errorMessage(error)}`)
          return err(request, { code: 'internal', message: 'directory import failed', details: {} })
        } finally {
          if (staging !== undefined) await rm(staging, { recursive: true, force: true }).catch(() => undefined)
        }
      },

      async rename(request) {
        const { payload } = request
        const owner = requestOwner(request)
        const access = owner === undefined ? { kind: 'local' as const } : { kind: 'account' as const, userId: owner }
        const workspace = ctx.workspaceRegistry.get(brandWorkspaceId(payload.workspaceId), access)
        if (workspace === undefined) return workspaceNotFound(request, payload.workspaceId)
        const title = payload.title.trim()
        // Uniqueness AND the same-title no-op both ride the create chain so
        // they observe the state left by earlier queued renames — checked
        // up front, a queued A→A could report success while an earlier A→B
        // still lands afterwards.
        const operation = workspaceCreationChain.then(async () => {
          if (title === workspace.title) return
          if (ctx.workspaceRegistry.list(access).some(other => other.id !== workspace.id && other.title === title)) {
            throw new WorkspaceNameConflictError(title)
          }
          await workspace.setTitle(title)
        })
        workspaceCreationChain = operation.then(() => undefined, () => undefined)
        try {
          await operation
        } catch (error: unknown) {
          if (error instanceof WorkspaceNameConflictError) {
            return err(request, {
              code: 'workspace-name-conflict',
              message: error.message,
              details: { name: error.workspaceName },
            })
          }
          throw error
        }
        return ok(request, { workspace: workspaceView(workspace) })
      },

      async delete(request) {
        const { workspaceId } = request.payload
        const owner = requestOwner(request)
        const access = owner === undefined ? { kind: 'local' as const } : { kind: 'account' as const, userId: owner }
        const operation = workspaceCreationChain.then(() =>
          ctx.workspaceRegistry.delete(brandWorkspaceId(workspaceId), access))
        workspaceCreationChain = operation.then(() => undefined, () => undefined)
        if (!await operation) return workspaceNotFound(request, workspaceId)
        return ok(request, { deleted: true as const })
      },

      async insertBefore(request) {
        const { workspaceId, beforeWorkspaceId } = request.payload
        const owner = requestOwner(request)
        const access = owner === undefined ? { kind: 'local' as const } : { kind: 'account' as const, userId: owner }
        try {
          const workspaceIds = await ctx.workspaceRegistry.insertBefore(
            brandWorkspaceId(workspaceId),
            beforeWorkspaceId === undefined ? undefined : brandWorkspaceId(beforeWorkspaceId),
            access,
          )
          return ok(request, { workspaceIds: [...workspaceIds] })
        } catch (error: unknown) {
          if (!(error instanceof WorkspaceOrderInvalidError)) throw error
          return workspaceNotFound(request, error.workspaceId)
        }
      },

      async insertSessionBefore(request) {
        const { payload } = request
        const denied = await authorizeSession(request, payload.sessionId)
        if (denied !== undefined) return err(request, denied)
        if (payload.beforeSessionId !== undefined) {
          const beforeDenied = await authorizeSession(request, payload.beforeSessionId)
          if (beforeDenied !== undefined) return err(request, beforeDenied)
        }
        const owner = requestOwner(request)
        const access = owner === undefined ? { kind: 'local' as const } : { kind: 'account' as const, userId: owner }
        const workspace = ctx.workspaceRegistry.get(brandWorkspaceId(payload.workspaceId), access)
        if (workspace === undefined) return workspaceNotFound(request, payload.workspaceId)
        try {
          await workspace.insertSessionBefore(payload.sessionId, payload.beforeSessionId)
        } catch (error: unknown) {
          // Only the entity's unaccounted-id rejection is the business code;
          // storage/durability failures propagate as internal errors.
          if (!(error instanceof WorkspaceMoveInvalidError)) throw error
          return err(request, {
            code: 'workspace-move-invalid',
            message: error.message,
            details: {
              workspaceId: payload.workspaceId,
              sessionId: payload.sessionId,
              ...payload.beforeSessionId === undefined ? {} : { beforeSessionId: payload.beforeSessionId },
            },
          })
        }
        return ok(request, { workspace: workspaceView(workspace) })
      },

      async archiveSession(request) {
        const { sessionId } = request.payload
        const denied = await authorizeSession(request, sessionId)
        if (denied !== undefined) return err(request, denied)
        try {
          await ctx.workspaceRegistry.archiveSession(sessionId)
        } catch (error: unknown) {
          // Only the registry's unknown-session rejection is the business
          // code; storage/durability failures propagate as internal errors.
          if (!(error instanceof WorkspaceUnknownSessionError)) throw error
          return err(request, {
            code: 'session-not-found',
            message: error.message,
            details: { sessionId },
          })
        }
        const owner = requestOwner(request)
        const access = owner === undefined ? { kind: 'local' as const } : { kind: 'account' as const, userId: owner }
        return ok(request, { archivedSessionIds: [...ctx.workspaceRegistry.archivedSessionIdsFor(access)] })
      },
    },

    host: {
      async describe(request) {
        // TODO: version should read apps/cli's package.json; placeholder for now.
        const selection = defaults.defaultModelSelection()
        const owner = requestOwner(request)
        const root = owner === undefined
          ? undefined
          : await accountRoot(owner)
        return Promise.resolve(ok(request, {
          version: '0.0.1',
          // Same source as session.create's fallback: the UI's default project
          // must match where an unspecified-cwd session actually lands.
          cwd: root ?? defaults.cwd,
          // Read live for the same reason: this is what the NEXT session will
          // start from, so a saved default has to be what it reports.
          provider: selection.provider,
          model: selection.model,
          attachedSessions: requestOwner(request) === undefined
            ? ctx.agents.list().length
            : ctx.agents.list().filter(agent => agent.session.header.ownerId === requestOwner(request)).length,
          home: root ?? homedir(),
          canOpenPath: requestOwner(request) === undefined && canOpenPaths(),
        }))
      },

      async pickDirectory(request, signal) {
        if (requestOwner(request) !== undefined) {
          return err(request, { code: 'unauthenticated', message: 'account principals cannot pick host directories', details: {} })
        }
        const capability = ctx.directoryPicker.capability()
        if (capability.kind !== 'native') {
          return err(request, {
            code: 'directory-picker-unavailable',
            message: `host.pickDirectory needs the native capability; the composed picker serves "${capability.kind}"`,
            details: { capability: capability.kind },
          })
        }
        try {
          const path = await capability.pick(signal)
          return ok(request, { path })
        } catch (error: unknown) {
          if (signal.aborted) {
            return err(request, {
              code: 'cancelled',
              message: 'directory picker was aborted',
              details: {},
            })
          }
          return err(request, {
            code: 'internal',
            message: `directory picker failed: ${error instanceof Error ? error.message : String(error)}`,
            details: {},
          })
        }
      },

      async listDirectory(request, signal) {
        const capability = ctx.directoryPicker.capability()
        if (capability.kind !== 'browse') {
          return err(request, {
            code: 'directory-picker-unavailable',
            message: `host.listDirectory needs the browse capability; the composed picker serves "${capability.kind}"`,
            details: { capability: capability.kind },
          })
        }
        try {
          // The carrier's signal follows the caller: a disconnect or timeout
          // stops the backend's directory scan instead of outliving it.
          const scoped = requestOwner(request) === undefined ? undefined : await accountPath(request, request.payload.path)
          if (signal.aborted) {
            return err(request, { code: 'cancelled', message: 'directory listing was aborted', details: {} })
          }
          const listing = await capability.list(scoped?.path ?? request.payload.path, signal)
          if (scoped === undefined) return ok(request, listing)
          return ok(request, {
            ...listing,
            path: scoped.path,
            home: scoped.root,
            crumbs: listing.crumbs.filter(crumb => contained(scoped.root, crumb.path)),
            entries: listing.entries.filter(entry => contained(scoped.root, entry.path)),
          })
        } catch (error: unknown) {
          // An abort is the caller's own timeout/disconnect, not a server
          // failure — same code pickDirectory and command.execute report.
          if (signal.aborted) {
            return err(request, { code: 'cancelled', message: 'directory listing was aborted', details: {} })
          }
          return err(request, directoryError(error))
        }
      },

      async createDirectory(request) {
        const capability = ctx.directoryPicker.capability()
        if (capability.kind !== 'browse') {
          return err(request, {
            code: 'directory-picker-unavailable',
            message: `host.createDirectory needs the browse capability; the composed picker serves "${capability.kind}"`,
            details: { capability: capability.kind },
          })
        }
        try {
          const scoped = await accountPath(request, request.payload.path)
          const path = await capability.createDirectory(scoped?.path ?? request.payload.path, request.payload.name)
          if (scoped !== undefined) {
            const canonical = await realpath(path)
            if (!contained(scoped.root, canonical)) throw new Error('created path is outside the account workspace root')
            return ok(request, { path: canonical })
          }
          return ok(request, { path })
        } catch (error: unknown) {
          return err(request, directoryError(error))
        }
      },

      async openPath(request, signal) {
        if (requestOwner(request) !== undefined) {
          return err(request, {
            code: 'unauthenticated',
            message: 'remote accounts cannot open host paths',
            details: {},
          })
        }
        return openPath(request, request.payload.path, signal)
      },
    },

    goals: {
      // Mutations only — the read side is the 'goal' session projection.
      // Every verb resolves the session's agent (agentFor: implicit cold
      // resume, the command.* precedent) and acknowledges with the new CAS
      // ref; the committed goal/change event carries the whole value to every
      // client through the projection frames.
      async create(request) {
        const { objective, maxGoalRounds } = request.payload
        return mutateGoal(request, (goals, agent) => goals.create(agent, {
          objective,
          ...(maxGoalRounds !== undefined ? { maxGoalRounds } : {}),
        }))
      },

      async edit(request) {
        const { ref, objective, maxGoalRounds } = request.payload
        return mutateGoal(request, (goals, agent) => goals.edit(agent, ref, {
          ...(objective !== undefined ? { objective } : {}),
          ...(maxGoalRounds !== undefined ? { maxGoalRounds } : {}),
        }))
      },

      async pause(request) {
        return mutateGoal(request, (goals, agent) => goals.pause(agent, request.payload.ref))
      },

      async resume(request) {
        return mutateGoal(request, (goals, agent) => goals.resume(agent, request.payload.ref))
      },

      async complete(request) {
        return mutateGoal(request, (goals, agent) => goals.complete(agent, request.payload.ref))
      },

      async clear(request) {
        const denied = await authorizeSession(request, request.payload.sessionId)
        if (denied !== undefined) return err(request, denied)
        const found = await agentFor(request.payload.sessionId)
        if ('error' in found) return err(request, found.error)
        const goals = goalServiceFor(found.agent)
        if ('error' in goals) return err(request, goals.error)
        try {
          goals.clear(found.agent, request.payload.ref)
          return ok(request, { cleared: true as const })
        } catch (error: unknown) {
          return goalError(request, error)
        }
      },
    },

    agentPresets: {
      // Local deployments with no roster answer with an empty list; account
      // callers fail loudly because an uncomposed account session is unsafe.
      async list(request) {
        const account = requestOwner(request) !== undefined
        const allowed = defaults.accountAgentPreset
        const presets = ctx.get('agentPresets')
        if (account && presets === undefined) {
          return err(request, { code: 'bad-request', message: 'account agent preset roster is not configured', details: { issues: [] } })
        }
        if (presets === undefined) return ok(request, { presets: [], authorable: false, hasDocument: false })
        const defaultId = presets.defaultId
        if (account && allowed === undefined) {
          return err(request, { code: 'bad-request', message: 'account agent preset is not configured', details: { issues: [] } })
        }
        return ok(request, {
          presets: (await presets.list()).filter(preset => !account || preset.id === allowed).map(preset => ({
            id: preset.id,
            trust: preset.trust,
            isDefault: preset.id === defaultId,
            ...preset.name === undefined ? {} : { name: preset.name },
            ...preset.description === undefined ? {} : { description: preset.description },
            ...preset.broken === undefined ? {} : { broken: preset.broken },
          })),
          authorable: account ? false : presets.authorable,
          hasDocument: account ? false : canOpenPaths(),
        })
      },

      // Recomposing is limited to a blank session because a started
      // conversation's history was produced under its preset's tools; the
      // agent and the session survive, only the composition is swapped.
      async select(request) {
        const localOnly = requireLocalPresetAccess(request)
        if (localOnly !== undefined) return err(request, localOnly)
        const { sessionId, agentPreset } = request.payload
        const denied = await authorizeSession(request, sessionId)
        if (denied !== undefined) return err(request, denied)
        const presets = ctx.get('agentPresets')
        if (presets === undefined) {
          return err(request, {
            code: 'agent-preset-not-found',
            message: 'this deployment composes no agent presets',
            details: { agentPreset, available: [] },
          })
        }
        const found = await agentFor(sessionId)
        if ('error' in found) return err(request, found.error)
        const { agent } = found
        const swap = async (): Promise<RpcResponse<{ agentPreset: string }>> => {
          // Re-read inside the queue: an earlier switch may have run, and a
          // conversation may have started, since this request arrived.
          if (!sessionBlank(agent.session)) {
            return err(request, {
              code: 'agent-preset-locked',
              message: `session "${sessionId}" has already started; its agent preset is fixed`,
              details: { sessionId, agentPreset },
            })
          }
          try {
            const preset = await presets.recompose(agent.ctx, agentPreset)
            // Recorded only after the swap committed: the log states what the
            // agent runs, and a rejected mount leaves the previous composition.
            agent.session.append('agent-preset/selected', { agentPreset: preset.id })
            return ok(request, { agentPreset: preset.id })
          } catch (error: unknown) {
            const refused = presetFailure(request, error)
            if (refused !== undefined) return refused
            return err(request, {
              code: 'internal',
              message: `failed to select agent preset "${agentPreset}": ${String(error)}`,
              details: {},
            })
          }
        }
        const queued = presetSwitches.get(sessionId) ?? Promise.resolve()
        const turn = queued.then(swap)
        presetSwitches.set(sessionId, turn.catch(() => undefined))
        try {
          return await turn
        } finally {
          if (presetSwitches.get(sessionId) === turn) presetSwitches.delete(sessionId)
        }
      },

      // Authoring is privileged (see PRIVILEGED_METHODS in dsh-client-connection):
      // a composition names the plugins a session runs, so reading one is
      // reconnaissance, and copy/remove/openDocument manage the roster and
      // drive the host desktop.
      async read(request) {
        const localOnly = requireLocalPresetAccess(request)
        if (localOnly !== undefined) return err(request, localOnly)
        const { agentPreset } = request.payload
        const presets = ctx.get('agentPresets')
        if (presets === undefined) return err(request, noRoster(agentPreset))
        try {
          const preset = await presets.resolve(agentPreset)
          return ok(request, {
            agentPreset: preset.id,
            trust: preset.trust,
            content: await presets.read(preset.id),
            ...preset.name === undefined ? {} : { name: preset.name },
            ...preset.description === undefined ? {} : { description: preset.description },
          })
        } catch (error: unknown) {
          return err(request, presetError(agentPreset, error))
        }
      },

      async copy(request) {
        const localOnly = requireLocalPresetAccess(request)
        if (localOnly !== undefined) return err(request, localOnly)
        const { from, agentPreset, name } = request.payload
        const presets = ctx.get('agentPresets')
        if (presets === undefined) return err(request, noRoster(agentPreset))
        try {
          await presets.copy(from, agentPreset, name)
          return ok(request, { agentPreset })
        } catch (error: unknown) {
          return err(request, presetError(agentPreset, error))
        }
      },

      async openDocument(request, signal) {
        const localOnly = requireLocalPresetAccess(request)
        if (localOnly !== undefined) return err(request, localOnly)
        const { agentPreset } = request.payload
        const presets = ctx.get('agentPresets')
        if (presets === undefined) return err(request, noRoster(agentPreset))
        try {
          const preset = await presets.resolve(agentPreset)
          // Same line as copy/remove draw: the shipped install is not the
          // user's to manage, and pointing an editor into it invites edits an
          // upgrade will silently overwrite.
          if (preset.trust !== 'user') {
            throw new PresetNotWritableError(preset.id, 'it ships with the deployment')
          }
          // The id resolved against the Host's own roots is what selects the
          // directory — no browser payload carries a path in either direction
          // unless the deployment has no opener to hand it to.
          const directory = dirname(preset.path)
          if (!canOpenPaths()) return ok(request, { opened: false as const, path: directory })
          return await openPath(request, directory, signal)
        } catch (error: unknown) {
          return err(request, presetError(agentPreset, error))
        }
      },

      async remove(request) {
        const localOnly = requireLocalPresetAccess(request)
        if (localOnly !== undefined) return err(request, localOnly)
        const { agentPreset } = request.payload
        const presets = ctx.get('agentPresets')
        if (presets === undefined) return err(request, noRoster(agentPreset))
        try {
          await presets.remove(agentPreset)
          return ok(request, {})
        } catch (error: unknown) {
          return err(request, presetError(agentPreset, error))
        }
      },
    },

    skills: {
      // Skill lookup never creates or resumes an agent: the session address
      // resolves to a canonical cwd from the host-resident session header, and
      // the view scope is the live agent or the preset's standing key.
      async list(request) {
        const { sessionId } = request.payload
        const denied = await authorizeSession(request, sessionId)
        if (denied !== undefined) return err(request, denied)
        const session = ctx.sessions.get(sessionId)
        if (session === undefined) {
          return err(request, {
            code: 'session-not-found',
            message: `session "${sessionId}" not found (not attached)`,
            details: { sessionId },
          })
        }
        if (session.header.cwd === undefined) {
          // Every served session records its project at create time; a
          // cwd-less header is a pre-project legacy log (not served).
          return err(request, { code: 'internal', message: `session "${sessionId}" has no project cwd`, details: {} })
        }
        const cwd = session.header.cwd
        // The host registry is layered per scope and serves every session. A
        // composition may still realm-mount its own registry instead; that
        // instance is invisible to host contexts, so address it through the
        // live agent (`agents.get` keeps the no-side-effect stance above).
        const live = ctx.agents.get(sessionId)
        const presets = ctx.get('agentPresets')
        const scoped = live === undefined ? undefined : presets?.serviceFor(live, 'skills')
        // Same stance as the commands domain: a missing service means no
        // composition mounts dsh-skill, not an empty catalog. `ctx.get` also
        // keeps this handler independent of the gateway plugin's inject list
        // (an undeclared `ctx.skills` property read fails the reflect proxy).
        const skillRegistry = scoped ?? ctx.get('skills')
        if (skillRegistry === undefined) {
          return err(request, { code: 'internal', message: 'skill registry is absent: neither this session\'s agent preset nor the host composition mounts @deepseek-ai/dsh-skill', details: {} })
        }
        // The scope presenters resolve in — the live agent, else the recorded
        // preset's standing key, else the global layer — so a cold session's
        // '/' popup lists the catalog its composition actually serves.
        const scope = await presenterScopeFor(sessionId, session)
        try {
          const ownerId = session.header.ownerId
          const skills = (await skillRegistry.list({
            cwd,
            scope,
            ...ownerId === undefined ? {} : { ownerId },
          })).filter(isUserInvocable)
          return ok(request, {
            skills: skills.map(skill => ({
              name: skill.name,
              description: skill.description,
              ...skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse },
              modelInvocable: skill.invocation.modelInvocable,
            })),
          })
        } catch (error: unknown) {
          return err(request, { code: 'internal', message: `skill listing failed: ${String(error)}`, details: {} })
        }
      },
    },

    settings: {
      describe(request) {
        const settings = ctx.get('settings')
        if (settings === undefined) return Promise.resolve(err(request, settingsAbsent()))
        return Promise.resolve(ok(request, {
          writable: settings.writable,
          hasDocument: settings.documentPath !== undefined,
          namespaces: settings.describe({ redactSecrets: true }).map(namespaceView),
        }))
      },
      async openDocument(request, signal) {
        const settings = ctx.get('settings')
        if (settings === undefined) return err(request, settingsAbsent())
        if (isAborted(signal)) {
          return err(request, {
            code: 'cancelled',
            message: 'settings document open was aborted',
            details: {},
          })
        }
        let path: string | undefined
        try {
          path = await settings.prepareDocument()
        } catch (error: unknown) {
          if (isAborted(signal)) {
            return err(request, {
              code: 'cancelled',
              message: 'settings document preparation was aborted',
              details: {},
            })
          }
          return err(request, {
            code: 'internal',
            message: `settings document preparation failed: ${error instanceof Error ? error.message : String(error)}`,
            details: {},
          })
        }
        if (path === undefined) {
          return err(request, {
            code: 'internal',
            message: 'settings provider has no local document to open',
            details: {},
          })
        }
        if (isAborted(signal)) {
          return err(request, {
            code: 'cancelled',
            message: 'settings document open was aborted',
            details: {},
          })
        }
        return openTextFile(request, path, signal)
      },
      update: request => settingsWrite(request, request.payload.ns, 'update', request.payload.patch, request.payload.expectedRevision),
      replace: request => settingsWrite(request, request.payload.ns, 'replace', request.payload.section, request.payload.expectedRevision),
      mutate: request => settingsWrite(request, request.payload.ns, 'mutate', request.payload.ops, request.payload.expectedRevision),
    },

    credentials: {
      async describe(request) {
        const credentials = ctx.get('credentials')
        if (credentials === undefined) return err(request, credentialsAbsent())
        const entries = await Promise.all(request.payload.refs.map(async (ref) => {
          const info = await credentials.describe(credentialRef(ref))
          const view: CredentialView = {
            configured: info.configured,
            ...info.source === undefined ? {} : { source: info.source },
            writable: info.writable,
          }
          return [ref, view] as const
        }))
        return ok(request, { credentials: Object.fromEntries(entries) })
      },

      async set(request) {
        const credentials = ctx.get('credentials')
        if (credentials === undefined) return err(request, credentialsAbsent())
        const { ref, value } = request.payload
        try {
          await credentials.set(credentialRef(ref), value)
        } catch (error: unknown) {
          return err(request, {
            code: 'credential-rejected',
            message: error instanceof Error ? error.message : String(error),
            details: { ref },
          })
        }
        return ok(request, {})
      },

      async unset(request) {
        const credentials = ctx.get('credentials')
        if (credentials === undefined) return err(request, credentialsAbsent())
        const { ref } = request.payload
        try {
          await credentials.unset(credentialRef(ref))
        } catch (error: unknown) {
          return err(request, {
            code: 'credential-rejected',
            message: error instanceof Error ? error.message : String(error),
            details: { ref },
          })
        }
        return ok(request, {})
      },
    },

    llm: {
      providers(request) {
        const registered = ctx.llm.listProviders()
        const active = new Set(registered.map(provider => provider.id))
        const directory = ctx.llm.listConfigurableProviders()
        const declared = new Set(directory.map(entry => entry.provider))
        const views: ConfigurableProviderView[] = directory.map(entry => ({
          provider: entry.provider,
          displayName: entry.displayName,
          settingsNs: entry.settingsNs,
          settingsPath: [...entry.settingsPath],
          active: active.has(entry.provider),
          ...entry.declared === undefined ? {} : { declared: entry.declared },
        }))
        // Routes registered without a directory declaration still appear —
        // they exist and serve models — just with no settings address. No
        // adapter claimed them, so nothing can say whether they are shipped.
        for (const provider of registered) {
          if (declared.has(provider.id)) continue
          views.push({
            provider: provider.id,
            displayName: provider.name,
            settingsNs: '',
            settingsPath: [],
            active: true,
          })
        }
        return Promise.resolve(ok(request, { providers: views }))
      },

      async models(request) {
        return ok(request, await buildModelCatalog(ctx))
      },

      async discoverModels(request, signal) {
        const { settingsNs, provider, baseURL, api, apiKey } = request.payload
        try {
          const models = await ctx.llm.discoverModels(settingsNs, {
            ...provider === undefined ? {} : { provider },
            ...baseURL === undefined ? {} : { baseURL },
            ...api === undefined ? {} : { api },
            ...apiKey === undefined ? {} : { apiKey },
            ...signal === undefined ? {} : { signal },
          })
          return ok(request, { models })
        } catch (error: unknown) {
          // Every failure here is the user's next move, not a transport fault:
          // a wrong endpoint, a rejected key, or a protocol with no listing all
          // end at the same place — fill the models in by hand. The details
          // repeat only what the caller already sent, never the credential.
          return err(request, {
            code: 'model-discovery-failed',
            message: error instanceof Error ? error.message : String(error),
            details: { settingsNs, ...baseURL === undefined ? {} : { baseURL } },
          })
        }
      },
    },

    events: {
      mux(request, signal) {
        const queue = new FrameQueue<RpcRequest<MuxFrame>>()
        muxQueues.add(queue)
        for (const session of ctx.sessions.list().filter(session => sessionVisibleTo(request, session))) {
          subscribeSession(queue, session)
        }
        for (const pending of pendingQuestions.values()) {
          const pendingSession = ctx.sessions.get(pending.sessionId)
          if (pendingSession === undefined ? requestOwner(request) !== undefined : !sessionVisibleTo(request, pendingSession)) continue
          queue.push({
            rpcId: pending.rpcId,
            payload: {
              type: 'question/requested', sessionId: pending.sessionId,
              questions: pending.questions,
            },
          })
        }
        // Refresh recovery: still-pending approval questions replay with their
        // stable rpcId so a reconnecting client can still answer them.
        for (const pending of pendingApprovals.values()) {
          const pendingSession = ctx.sessions.get(pending.sessionId)
          if (pendingSession === undefined ? requestOwner(request) !== undefined : !sessionVisibleTo(request, pendingSession)) continue
          queue.push(requestedFrame(pending))
        }
        // Queue snapshot baseline (pendingQuestions precedent): frames replayed
        // in arrival order per session; a reconnecting client rebuilds its
        // queue view from these alone.
        for (const session of ctx.sessions.list().filter(session => sessionVisibleTo(request, session))) {
          const agent = ctx.agents.get(session.id)
          if (agent?.session === session && agent.inbox.hasPending) {
            queue.push(frame({ type: 'session/queue', sessionId: session.id, items: queueItems(agent) }))
          }
        }
        // Background-task baseline. `ctx.agents.get` is the non-resuming read:
        // a session with no live Agent owns no tasks, so it correctly sees only
        // the unowned ones, and listing never revives a cold session. An empty
        // set sends nothing — absence is how the client reads "no tasks".
        const jobs = ctx.get('jobs')
        if (jobs !== undefined) {
          for (const session of ctx.sessions.list().filter(session => sessionVisibleTo(request, session))) {
            const views = jobViews(jobs.list(ctx.agents.get(session.id)))
            if (views.length > 0) {
              queue.push(frame({ type: 'session/jobs', sessionId: session.id, jobs: views }))
            }
          }
        }
        // Per-session open-call table for result-view pairing. Bounded by the
        // per-turn call count: entries clear on turn/end; a table miss (stream
        // opened mid-turn) backscans the session's in-memory events instead.
        const openCalls = new Map<SessionId, Map<string, { name: string; args: unknown }>>()
        const disposers = [
          ctx.on('session/event', (session: Session, event: SessionEvent) => {
            if (!sessionVisibleTo(request, session)) return
            if (event.type === 'tool/call') {
              const data = event.data as ToolCallData
              try {
                let table = openCalls.get(session.id)
                if (table === undefined) openCalls.set(session.id, table = new Map<string, { name: string; args: unknown }>())
                table.set(data.callId, { name: data.name, args: JSON.parse(data.arguments) })
              } catch {
                // Unparseable model arguments: leave the table unset; the result view soft-falls.
              }
            } else if (event.type === 'turn/end') {
              openCalls.delete(session.id)
            }
            const view = viewFor(
              ctx, event,
              callId => openCalls.get(session.id)?.get(callId) ?? backscanArgs(session.events, callId),
              ctx.agents.get(session.id),
            )
            queue.push(frame({ type: 'session/event', sessionId: session.id, event, ...view === undefined ? {} : { view } }))
          }),
          ctx.on('session/created', (session: Session) => {
            if (!sessionVisibleTo(request, session)) return
            subscribeSession(queue, session)
            // The subscribe frame clears the client's task mirror, and a
            // session born after the stream opened missed the baseline loop.
            // Unowned tasks are visible to it from birth, so without this it
            // would show none until the next registry change.
            const views = jobs === undefined ? [] : jobViews(jobs.list(ctx.agents.get(session.id)))
            if (views.length > 0) {
              queue.push(frame({ type: 'session/jobs', sessionId: session.id, jobs: views }))
            }
          }),
          ctx.on('session/disposed', (session: Session) => {
            openCalls.delete(session.id)
          }),
          ...jobs === undefined ? [] : [jobs.onJobsChanged((owner) => {
            if (owner !== undefined) {
              if (!sessionVisibleTo(request, owner.session)) return
              // The exact owner instance the fence compares against, so the
              // push stays correct even while that Agent's scope is tearing
              // down and a lookup by id would already miss.
              queue.push(frame({ type: 'session/jobs', sessionId: owner.id, jobs: jobViews(jobs.list(owner)) }))
              return
            }
            // An unowned task is visible to every caller, so every subscribed
            // session's set changed with it.
            for (const session of ctx.sessions.list()) {
              if (!sessionVisibleTo(request, session)) continue
              queue.push(frame({
                type: 'session/jobs',
                sessionId: session.id,
                jobs: jobViews(jobs.list(ctx.agents.get(session.id))),
              }))
            }
          })],
        ]
        return queue.iterate(signal, () => {
          muxQueues.delete(queue)
          for (const dispose of disposers) dispose()
        })
      },

      host(request, signal) {
        const queue = new FrameQueue<RpcRequest<HostFrame>>()
        const requestOwnerId = requestOwner(request)
        const workspaceAccess = requestOwnerId === undefined
          ? { kind: 'local' as const }
          : { kind: 'account' as const, userId: requestOwnerId }
        const committedWorkspaces = ctx.workspaceRegistry.list(workspaceAccess)
        const committedWorkspaceIds = new Set(
          committedWorkspaces.map(workspace => String(workspace.id)),
        )
        let committedWorkspaceOrder = committedWorkspaces.map(workspace => workspace.id)
        // Frame-dedup baseline, same posture as committedWorkspaceIds: the
        // stream opens against the current set; workspace.list re-baselines
        // reconnecting clients, so only later changes need frames.
        const visibleArchived = (ids: readonly SessionId[]): SessionId[] => requestOwnerId === undefined
          ? [...ids]
          : [...ctx.workspaceRegistry.archivedSessionIdsFor(workspaceAccess)]
        let archivedSessionIds = visibleArchived(ctx.workspaceRegistry.archivedSessionIds)
        const disposers = [
          ctx.on('session/created', (session: Session) => {
            if (!sessionVisibleTo(request, session)) return
            queue.push(frame({
              type: 'host/session-added',
              sessionId: session.id,
              // Derived at frame time like summarize(); a just-created session
              // has run no turn yet, so this is constantly true in practice.
              blank: sessionBlank(session),
              // Including cwd lets the client group the new session without refreshing the list.
              ...sessionListFields(session.header, session.events),
            }))
          }),
          ctx.on('session/disposed', (session: Session) => {
            if (!sessionVisibleTo(request, session)) return
            queue.push(frame({ type: 'host/session-removed', sessionId: session.id }))
          }),
          ctx.on('agent/status', ({ agent, status }: { agent: Agent; status: AgentStatus }) => {
            if (!sessionVisibleTo(request, agent.session)) return
            queue.push(frame({ type: 'host/session-status', sessionId: agent.id, running: status === 'running' }))
          }),
          ctx.on('agent/error', ({ agent, error }: { agent: Agent; error: unknown }) => {
            if (!sessionVisibleTo(request, agent.session)) return
            queue.push(frame({ type: 'host/agent-error', sessionId: agent.id, message: errorChain(error) }))
          }),
          ctx.on('domain/changed', (change) => {
            if (change.domain !== 'workspace') return
            if (change.table === '') {
              if (change.operation !== 'put') return
              const state = workspaceDomainState.parse(change.value)
              const scopedOrder = state.workspaceIds.filter(workspaceId =>
                ctx.workspaceRegistry.get(workspaceId, workspaceAccess) !== undefined)
              const orderChanged = scopedOrder.length === committedWorkspaceOrder.length
                && scopedOrder.every(workspaceId => committedWorkspaceIds.has(String(workspaceId)))
                && scopedOrder.some((workspaceId, index) => workspaceId !== committedWorkspaceOrder[index])
              for (const workspaceId of scopedOrder) {
                if (committedWorkspaceIds.has(workspaceId)) continue
                const workspace = ctx.workspaceRegistry.get(workspaceId, workspaceAccess)
                if (workspace === undefined) {
                  throw new Error(`committed workspace registry references missing workspace "${workspaceId}"`)
                }
                committedWorkspaceIds.add(workspaceId)
                queue.push(frame({ type: 'host/workspace-changed', workspace: workspaceView(workspace) }))
              }
              committedWorkspaceOrder = [...scopedOrder]
              if (orderChanged) {
                queue.push(frame({
                  type: 'host/workspace-order-changed',
                  workspaceIds: [...scopedOrder],
                }))
              }
              const nextArchivedSessionIds = visibleArchived(state.archivedSessionIds)
              if (nextArchivedSessionIds.length !== archivedSessionIds.length
                || nextArchivedSessionIds.some((id, index) => id !== archivedSessionIds[index])) {
                archivedSessionIds = nextArchivedSessionIds
                queue.push(frame({
                  type: 'host/archived-sessions-changed',
                  archivedSessionIds: nextArchivedSessionIds,
                }))
              }
              return
            }
            if (change.table !== 'workspaces') return
            if (change.operation === 'deleted') {
              if (!committedWorkspaceIds.delete(change.key)) return
              queue.push(frame({
                type: 'host/workspace-removed',
                workspaceId: change.key as WorkspaceId,
              }))
              return
            }
            if (!committedWorkspaceIds.has(change.key)) return
            const changedRecord = workspaceRecord.parse(change.value)
            const ownerMatches = workspaceAccess.kind === 'local'
              ? changedRecord.owner.kind === 'local'
              : changedRecord.owner.kind === 'account' && changedRecord.owner.userId === workspaceAccess.userId
            if (!ownerMatches) return
            // Existing-entity table writes are complete attach/touch commits.
            // A new entity's first put waits for the global registry write above.
            queue.push(frame({
              type: 'host/workspace-changed',
              workspace: changedWorkspaceView(change.key, change.value),
            }))
          }),
          // Allowlisted host events ride one verbatim wrapper frame each. The
          // allowlist is api-remotes', and `ctx.remote.$on` is the consumer
          // face; nothing here projects, redacts, or renames.
          ...API_REMOTE_FORWARDED_EVENTS.map(name => ctx.on(
            name,
            // The allowlist's shape assertion proves each name is a real,
            // non-scoped, void-returning event, so the rest-parameter handler
            // satisfies every member of the union `on` accepts here;
            // assertJsonArgs proves the payload is JSON-safe before it queues.
            ((...args: unknown[]) => {
              if (requestOwner(request) !== undefined) return
              queue.push(frame({
                type: 'host/remote-event',
                event: name,
                args: assertJsonArgs(name, args),
              }))
            }),
          )),
        ]
        return queue.iterate(signal, () => { for (const dispose of disposers) dispose() })
      },
    },

    downloads: {
      async sessionLog(request, signal, principal?: RpcPrincipal) {
        if (principal?.kind === 'account') {
          try {
            const state = await readSessionState(request.sessionId)
            if (state.header.ownerId !== brandSessionOwnerId(principal.userId)) return new Response('session not found', { status: 404 })
          } catch (error: unknown) {
            if (error instanceof SessionNotFound) return new Response('session not found', { status: 404 })
            throw error
          }
        }
        // Clean error path first: missing services answer 500 and a missing
        // root artifact 404 before any zip byte is produced. The root content
        // read here is reused as the first zip entry, so nothing is read twice.
        const deps = sessionLogExportDeps(ctx)
        if (deps.sessionQuery === undefined || deps.sessionPersistence === undefined || deps.attachments === undefined) {
          return new Response(
            'session log export is unavailable: missing session-query, session-persistence, or attachments service',
            { status: 500 },
          )
        }
        if (!deps.sessionPersistence.supportsRawArtifacts) {
          return new Response(
            'session log export is unavailable: the persistence backend does not expose per-session raw artifacts',
            { status: 501 },
          )
        }
        const ready: SessionLogExportReady = {
          sessionQuery: deps.sessionQuery,
          sessionPersistence: deps.sessionPersistence,
          attachments: deps.attachments,
          sessions: deps.sessions,
        }
        let root: SessionRawArtifact | undefined
        try {
          await flushLiveSessionLog(deps, request.sessionId, signal)
          root = await deps.sessionPersistence.readRaw(request.sessionId, signal)
          signal.throwIfAborted()
        } catch {
          signal.throwIfAborted()
          // Root preparation failure: answer 500 without echoing the error,
          // which may carry absolute host paths into the browser error bar.
          return new Response('session log export failed to prepare the stored artifact', { status: 500 })
        }
        if (root === undefined) {
          return new Response('session not found', { status: 404 })
        }
        return new Response(
          streamSessionLogZip(
            ready,
            root,
            request.sessionId,
            request.includeDescendants === true,
            sessionExportCompressionLevel,
            signal,
          ),
          {
            headers: {
              'content-type': 'application/zip',
              'content-disposition': `attachment; filename="${sessionLogZipFilename(request.sessionId)}"`,
            },
          },
        )
      },
    },

    respond(message: ClientResponse, principal?: RpcPrincipal): Promise<RpcReceipt> {
      // Route by the echoed rpcId (the wire correlation): approvals first,
      // then questions — the two registries share one id space of UUIDs.
      const approval = pendingApprovals.get(message.rpcId)
      if (approval !== undefined) {
        const session = ctx.sessions.get(approval.sessionId)
        if (principal?.kind === 'account' && session?.header.ownerId !== brandSessionOwnerId(principal.userId)) {
          return Promise.resolve({ accepted: false, reason: 'not-pending' })
        }
        if (!message.result.ok) return Promise.resolve({ accepted: false, reason: 'bad-response' })
        const parsed = approvalResponsePayloadSchema.safeParse(message.result.value)
        // The payload's audit correlation must match the entry the rpcId routed
        // to — a mismatched answer is malformed, not merely late.
        if (!parsed.success || parsed.data.approvalId !== approval.approvalId || parsed.data.sessionId !== approval.sessionId) {
          return Promise.resolve({ accepted: false, reason: 'bad-response' })
        }
        approval.resolve(parsed.data.outcome)
        return Promise.resolve({ accepted: true })
      }
      const pending = pendingQuestions.get(message.rpcId)
      if (pending === undefined) return Promise.resolve({ accepted: false, reason: 'not-pending' })
      const session = ctx.sessions.get(pending.sessionId)
      if (principal?.kind === 'account' && session?.header.ownerId !== brandSessionOwnerId(principal.userId)) {
        return Promise.resolve({ accepted: false, reason: 'not-pending' })
      }
      if (!message.result.ok) {
        if (message.result.error.code !== 'cancelled') {
          return Promise.resolve({ accepted: false, reason: 'bad-response' })
        }
        claimQuestion(pending, 'cancelled')
        pending.reject(new UserQuestionError(
          'the user cancelled ask_user_question', 'ASK_CANCELLED'))
        return Promise.resolve({ accepted: true })
      }
      const parsed = questionResponsePayloadSchema.safeParse(message.result.value)
      if (!parsed.success) {
        return Promise.resolve({ accepted: false, reason: 'bad-response' })
      }
      const payload: QuestionResponsePayload = {
        sessionId: parsed.data.sessionId,
        answer: {
          answers: parsed.data.answer.answers.map(answer => ({
            id: answer.id,
            selected: answer.selected,
            ...(answer.custom === undefined ? {} : { custom: answer.custom }),
          })),
        },
      }
      if (!matchesQuestions(payload, pending)) {
        return Promise.resolve({ accepted: false, reason: 'bad-response' })
      }
      claimQuestion(pending, 'answered')
      pending.resolve(payload.answer)
      return Promise.resolve({ accepted: true })
    },

    // ---- xiaowei multi-user account seam ----
    // Anonymous callers may present an existing invitation to signup or
    // emailCode, while signin remains public. signout / state require a valid bearer in the
    // Authorization header; the connection-plugin fence verifies the token
    // before the request reaches this block. Privileged mutation methods
    // (wallet.credit/debit/setQuota/refreshDaily/grantWelcomeBonus,
    // modelKeys.provision/revoke) are still loopback-only — the fence
    // rejects any non-loopback caller regardless of bearer. The wallet
    // signup trigger chain (welcome bonus + model-key provision) lives in
    // `account.signup` so a single round trip creates the user, grants 20
    // CNY, and mints the first API key.
    account: {
      async signup(request): Promise<RpcResponse<SignedIn>> {
        const identity = ctx.get('identity')
        if (identity === undefined) return err(request, { code: 'internal', message: 'identity service is not mounted', details: {} })
        const emailVerification = ctx.get('emailVerification')
        const wallet = ctx.get('wallet')
        const userModelKeys = ctx.get('userModelKeys')
        try {
          // Verification gate (when the seam is on): the renderer is required
          // to round-trip account.emailCode first; the host surfaces a stable
          // code the renderer can branch on without parsing the message.
          if (emailVerification !== undefined && emailVerification.isEnabled()) {
            const code = request.payload.verificationCode
            if (typeof code !== 'string' || code.length === 0) {
              return err(request, { code: 'verification-code-required', message: '请先获取邮箱验证码', details: {} })
            }
            try {
              const invitation = await identityForInvitation(ctx, request.payload.invitationCode)
              if (invitation === undefined) return err(request, { code: 'bad-request', message: '邀请链接无效', details: { issues: [] } })
              await emailVerification.verifyCode({ email: request.payload.email, code, purpose: 'signup', invitationId: invitation.invitationId })
            } catch (verErr) {
              if (isServiceError<EmailVerificationError>(verErr)) {
                const wireCode = emailVerificationCodeToWire(verErr.code)
                return err(request, { code: wireCode, message: verErr.message, ...emailVerificationErrorDetails(verErr) } as RpcError)
              }
              throw verErr
            }
          }
          const signed = await identity.signup({
            email: request.payload.email,
            password: request.payload.password,
            invitationCode: request.payload.invitationCode,
            ...(request.payload.displayName !== undefined ? { displayName: request.payload.displayName } : {}),
          })
          // Trigger chain: best-effort welcome bonus + first model key. A
          // failure here does NOT roll back the identity row — the user has
          // signed up and a follow-up script can repair the wallet/key side.
          if (wallet !== undefined) {
            try {
              await wallet.grantWelcomeBonus({ userId: signed.userId })
            } catch (walletErr) {
              ctx.logger.warn(
                'xiaowei: welcome bonus failed userId=%s reason=%s',
                String(signed.userId),
                errorMessage(walletErr),
              )
            }
          }
          if (userModelKeys !== undefined) {
            try {
              await userModelKeys.provision({ userId: signed.userId, label: `xiaowei-${shortUserId(String(signed.userId))}` })
            } catch (keyErr) {
              ctx.logger.warn(
                'xiaowei: model-key provision failed userId=%s reason=%s',
                String(signed.userId),
                errorMessage(keyErr),
              )
            }
          }
          return { rpcId: request.rpcId, result: { ok: true, value: signed } }
        } catch (signErr) {
          if (isServiceError<IdentityError>(signErr)) {
            const wireCode = identityErrorCodeToWire(signErr.code)
            return err(request, { code: wireCode, message: signErr.message, details: {} } as RpcError)
          }
          throw signErr
        }
      },

      async emailCode(request): Promise<RpcResponse<{ expiresInSeconds: number; retryAfterSeconds: number }>> {
        const verification = ctx.get('emailVerification')
        if (verification === undefined) {
          return err(request, { code: 'internal', message: 'email-verification service is not mounted', details: {} })
        }
        try {
          const invitation = await identityForInvitation(ctx, request.payload.invitationCode)
          if (invitation === undefined) return err(request, { code: 'bad-request', message: '邀请链接无效', details: { issues: [] } })
          const value = await verification.requestCode({ email: request.payload.email, purpose: 'signup', invitationId: invitation.invitationId })
          return { rpcId: request.rpcId, result: { ok: true, value } }
        } catch (verErr) {
          if (isServiceError<EmailVerificationError>(verErr)) {
            const wireCode = emailVerificationCodeToWire(verErr.code)
            return err(request, { code: wireCode, message: verErr.message, ...emailVerificationErrorDetails(verErr) } as RpcError)
          }
          throw verErr
        }
      },

      invites: {
        async create(request): Promise<RpcResponse<InvitationView & { code: string }>> {
          if (request.principal?.kind !== 'account') {
            return err(request, { code: 'unauthenticated', message: 'account authentication required', details: {} })
          }
          const identity = ctx.get('identity')
          if (identity === undefined) {
            return err(request, { code: 'internal', message: 'identity service is not mounted', details: {} })
          }
          try {
            const created = await identity.createInvitation({ ownerId: request.principal.userId as never })
            return { rpcId: request.rpcId, result: { ok: true, value: created } }
          } catch (error) {
            if (isServiceError<IdentityError>(error)) {
              return err(request, {
                code: identityErrorCodeToWire(error.code),
                message: error.message,
                details: {},
              } as RpcError)
            }
            throw error
          }
        },

        async list(request): Promise<RpcResponse<{ items: InvitationView[] }>> {
          if (request.principal?.kind !== 'account') {
            return err(request, { code: 'unauthenticated', message: 'account authentication required', details: {} })
          }
          const identity = ctx.get('identity')
          if (identity === undefined) {
            return err(request, { code: 'internal', message: 'identity service is not mounted', details: {} })
          }
          const items = await identity.listInvitations({ ownerId: request.principal.userId as never })
          return { rpcId: request.rpcId, result: { ok: true, value: { items } } }
        },

        async rotate(request): Promise<RpcResponse<InvitationView & { code: string }>> {
          if (request.principal?.kind !== 'account') return err(request, { code: 'unauthenticated', message: 'account authentication required', details: {} })
          const identity = ctx.get('identity')
          if (identity === undefined) return err(request, { code: 'internal', message: 'identity service is not mounted', details: {} })
          try {
            const rotated = await identity.rotateInvitation({
              ownerId: request.principal.userId as never,
              invitationId: request.payload.invitationId as never,
            })
            return { rpcId: request.rpcId, result: { ok: true, value: rotated } }
          } catch (error) {
            if (isServiceError<IdentityError>(error)) {
              return err(request, {
                code: identityErrorCodeToWire(error.code),
                message: error.message,
                details: {},
              } as RpcError)
            }
            throw error
          }
        },
      },

      async signin(request): Promise<RpcResponse<SignedIn>> {
        const identity = ctx.get('identity')
        if (identity === undefined) return err(request, { code: 'internal', message: 'identity service is not mounted', details: {} })
        try {
          const signed = await identity.signin({ email: request.payload.email, password: request.payload.password })
          // Idempotently repair accounts created before wallet or model-key
          // provisioning was enabled. Authentication remains independent of
          // an upstream management-plane outage; the model route fails closed
          // later if the credential still cannot be provisioned.
          const wallet = ctx.get('wallet')
          if (wallet !== undefined) {
            try {
              await wallet.grantWelcomeBonus({ userId: signed.userId })
            } catch (walletErr) {
              ctx.logger.warn(
                'xiaowei: signin wallet repair failed userId=%s reason=%s',
                String(signed.userId),
                errorMessage(walletErr),
              )
            }
          }
          const userModelKeys = ctx.get('userModelKeys')
          if (userModelKeys !== undefined) {
            try {
              await userModelKeys.provision({ userId: signed.userId, label: `xiaowei-${shortUserId(String(signed.userId))}` })
            } catch (keyErr) {
              ctx.logger.warn(
                'xiaowei: signin model-key repair failed userId=%s reason=%s',
                String(signed.userId),
                errorMessage(keyErr),
              )
            }
          }
          return { rpcId: request.rpcId, result: { ok: true, value: signed } }
        } catch (signErr) {
          if (isServiceError<IdentityError>(signErr)) {
            return err(request, { code: identityErrorCodeToWire(signErr.code), message: signErr.message, details: {} } as RpcError)
          }
          throw signErr
        }
      },

      async signout(request): Promise<RpcResponse<{ revoked: true }>> {
        const identity = ctx.get('identity')
        if (identity === undefined) return err(request, { code: 'internal', message: 'identity service is not mounted', details: {} })
        // Idempotent: an unknown / already-revoked token resolves with
        // { revoked: true } per the seam's own contract.
        await identity.signout({ sessionToken: request.payload.sessionToken as never })
        return { rpcId: request.rpcId, result: { ok: true, value: { revoked: true as const } } }
      },

      async state(request): Promise<RpcResponse<AuthenticatedView | null>> {
        const identity = ctx.get('identity')
        if (identity === undefined) return { rpcId: request.rpcId, result: { ok: true, value: null } }
        const view = await identity.validate({ sessionToken: request.payload.sessionToken as never })
        return { rpcId: request.rpcId, result: { ok: true, value: view } }
      },
    },

    customModels: {
      async create(request): Promise<RpcResponse<CustomModelView>> {
        const service = ctx.get('userModelKeys')
        if (service === undefined) return err(request, { code: 'internal', message: 'user-model-keys service is not mounted', details: {} })
        if (request.principal?.kind !== 'account') return err(request, { code: 'unauthenticated', message: 'account authentication required', details: {} })
        try {
          const value = await service.createCustom({ userId: request.principal.userId as never, ...request.payload })
          const { userId: _userId, ...publicValue } = value
          return { rpcId: request.rpcId, result: { ok: true, value: publicValue } }
        } catch (error) {
          if (isServiceError<ModelKeyError>(error)) {
            return err(request, {
              code: modelKeyErrorCodeToWire(error.code),
              message: error.message,
              ...modelKeyErrorDetails(error, undefined),
            } as RpcError)
          }
          throw error
        }
      },
      async list(request): Promise<RpcResponse<{ items: CustomModelView[] }>> {
        const service = ctx.get('userModelKeys')
        if (service === undefined) return err(request, { code: 'internal', message: 'user-model-keys service is not mounted', details: {} })
        if (request.principal?.kind !== 'account') return err(request, { code: 'unauthenticated', message: 'account authentication required', details: {} })
        const items = await service.listCustom({ userId: request.principal.userId as never })
        return {
          rpcId: request.rpcId,
          result: {
            ok: true,
            value: { items: items.map(({ userId: _userId, ...item }) => item as CustomModelView) },
          },
        }
      },
      async remove(request): Promise<RpcResponse<{ removed: boolean }>> {
        const service = ctx.get('userModelKeys')
        if (service === undefined) return err(request, { code: 'internal', message: 'user-model-keys service is not mounted', details: {} })
        if (request.principal?.kind !== 'account') return err(request, { code: 'unauthenticated', message: 'account authentication required', details: {} })
        const value = await service.removeCustom({
          userId: request.principal.userId as never,
          customModelId: request.payload.customModelId as CustomModelId,
        })
        return { rpcId: request.rpcId, result: { ok: true, value } }
      },
    },

    wallet: {
      async get(request): Promise<RpcResponse<WalletView>> {
        const wallet = ctx.get('wallet')
        if (wallet === undefined) return err(request, { code: 'internal', message: 'wallet service is not mounted', details: {} })
        try {
          const userId = request.principal?.kind === 'account' ? request.principal.userId : request.payload.userId
          const view = await wallet.get({ userId: userId as never })
          return { rpcId: request.rpcId, result: { ok: true, value: view } }
        } catch (walletErr) {
          if (isServiceError<WalletError>(walletErr)) {
            return err(request, {
              code: walletErrorCodeToWire(walletErr.code),
              message: walletErr.message,
              ...walletErrorDetails(walletErr),
            } as RpcError)
          }
          throw walletErr
        }
      },
      async credit(request): Promise<RpcResponse<WalletView>> {
        const wallet = ctx.get('wallet')
        if (wallet === undefined) return err(request, { code: 'internal', message: 'wallet service is not mounted', details: {} })
        if (request.principal?.kind === 'account') return err(request, { code: 'unauthenticated', message: 'wallet management requires a local principal', details: {} })
        try {
          const view = await wallet.credit({
            userId: request.payload.userId as never,
            amountMicros: request.payload.amountMicros,
            reason: request.payload.reason,
            ...(request.payload.idempotencyKey !== undefined ? { idempotencyKey: request.payload.idempotencyKey } : {}),
          })
          return { rpcId: request.rpcId, result: { ok: true, value: view } }
        } catch (walletErr) {
          if (isServiceError<WalletError>(walletErr)) {
            return err(request, {
              code: walletErrorCodeToWire(walletErr.code),
              message: walletErr.message,
              ...walletErrorDetails(walletErr),
            } as RpcError)
          }
          throw walletErr
        }
      },
      async debit(request): Promise<RpcResponse<WalletView>> {
        const wallet = ctx.get('wallet')
        if (wallet === undefined) return err(request, { code: 'internal', message: 'wallet service is not mounted', details: {} })
        if (request.principal?.kind === 'account') return err(request, { code: 'unauthenticated', message: 'wallet management requires a local principal', details: {} })
        try {
          const view = await wallet.debit({
            userId: request.payload.userId as never,
            amountMicros: request.payload.amountMicros,
            reason: request.payload.reason,
            ...(request.payload.idempotencyKey !== undefined ? { idempotencyKey: request.payload.idempotencyKey } : {}),
          })
          return { rpcId: request.rpcId, result: { ok: true, value: view } }
        } catch (walletErr) {
          if (isServiceError<WalletError>(walletErr)) {
            return err(request, {
              code: walletErrorCodeToWire(walletErr.code),
              message: walletErr.message,
              ...walletErrorDetails(walletErr),
            } as RpcError)
          }
          throw walletErr
        }
      },
      async setQuota(request): Promise<RpcResponse<WalletView>> {
        const wallet = ctx.get('wallet')
        if (wallet === undefined) return err(request, { code: 'internal', message: 'wallet service is not mounted', details: {} })
        if (request.principal?.kind === 'account') return err(request, { code: 'unauthenticated', message: 'wallet management requires a local principal', details: {} })
        try {
          const view = await wallet.setQuota({
            userId: request.payload.userId as never,
            balanceMicros: request.payload.balanceMicros,
            reason: request.payload.reason,
          })
          return { rpcId: request.rpcId, result: { ok: true, value: view } }
        } catch (walletErr) {
          if (isServiceError<WalletError>(walletErr)) {
            return err(request, {
              code: walletErrorCodeToWire(walletErr.code),
              message: walletErr.message,
              ...walletErrorDetails(walletErr),
            } as RpcError)
          }
          throw walletErr
        }
      },
      async refreshDaily(request): Promise<RpcResponse<WalletView>> {
        const wallet = ctx.get('wallet')
        if (wallet === undefined) return err(request, { code: 'internal', message: 'wallet service is not mounted', details: {} })
        if (request.principal?.kind === 'account') return err(request, { code: 'unauthenticated', message: 'wallet management requires a local principal', details: {} })
        try {
          const view = await wallet.refreshDaily({
            userId: request.payload.userId as never,
            idempotencyKey: request.payload.idempotencyKey,
          })
          return { rpcId: request.rpcId, result: { ok: true, value: view } }
        } catch (walletErr) {
          if (isServiceError<WalletError>(walletErr)) {
            return err(request, {
              code: walletErrorCodeToWire(walletErr.code),
              message: walletErr.message,
              ...walletErrorDetails(walletErr),
            } as RpcError)
          }
          throw walletErr
        }
      },
      async grantWelcomeBonus(request): Promise<RpcResponse<WalletView>> {
        const wallet = ctx.get('wallet')
        if (wallet === undefined) return err(request, { code: 'internal', message: 'wallet service is not mounted', details: {} })
        if (request.principal?.kind === 'account') return err(request, { code: 'unauthenticated', message: 'wallet management requires a local principal', details: {} })
        try {
          const view = await wallet.grantWelcomeBonus({ userId: request.payload.userId as never })
          return { rpcId: request.rpcId, result: { ok: true, value: view } }
        } catch (walletErr) {
          if (isServiceError<WalletError>(walletErr)) {
            return err(request, {
              code: walletErrorCodeToWire(walletErr.code),
              message: walletErr.message,
              ...walletErrorDetails(walletErr),
            } as RpcError)
          }
          throw walletErr
        }
      },
      async listLedger(request): Promise<RpcResponse<{ items: LedgerEntry[] }>> {
        const wallet = ctx.get('wallet')
        if (wallet === undefined) return err(request, { code: 'internal', message: 'wallet service is not mounted', details: {} })
        try {
          const userId = request.principal?.kind === 'account' ? request.principal.userId : request.payload.userId
          const items = await wallet.listLedger({
            userId: userId as never,
            ...(request.payload.limit !== undefined ? { limit: request.payload.limit } : {}),
          })
          return { rpcId: request.rpcId, result: { ok: true, value: { items } } }
        } catch (walletErr) {
          if (isServiceError<WalletError>(walletErr)) {
            return err(request, {
              code: walletErrorCodeToWire(walletErr.code),
              message: walletErr.message,
              ...walletErrorDetails(walletErr),
            } as RpcError)
          }
          throw walletErr
        }
      },
    },

    modelKeys: {
      async provision(request): Promise<RpcResponse<ProvisionedKey>> {
        const userModelKeys = ctx.get('userModelKeys')
        if (userModelKeys === undefined) return err(request, { code: 'internal', message: 'user-model-keys service is not mounted', details: {} })
        if (request.principal?.kind === 'account') return err(request, { code: 'unauthenticated', message: 'model-key management requires a local principal', details: {} })
        try {
          const userId = request.payload.userId
          if (userId === undefined) return err(request, { code: 'unauthenticated', message: 'account authentication required', details: {} })
          const view = await userModelKeys.provision({
            userId: userId as never,
            ...(request.payload.label !== undefined ? { label: request.payload.label } : {}),
          })
          return { rpcId: request.rpcId, result: { ok: true, value: view } }
        } catch (keyErr) {
          if (isServiceError<ModelKeyError>(keyErr)) {
            return err(request, {
              code: modelKeyErrorCodeToWire(keyErr.code),
              message: keyErr.message,
              ...modelKeyErrorDetails(keyErr, undefined),
            } as RpcError)
          }
          throw keyErr
        }
      },
      async list(request): Promise<RpcResponse<{ items: ModelKeyView[] }>> {
        const userModelKeys = ctx.get('userModelKeys')
        if (userModelKeys === undefined) return err(request, { code: 'internal', message: 'user-model-keys service is not mounted', details: {} })
        const userId = request.principal?.kind === 'account' ? request.principal.userId : request.payload.userId
        if (userId === undefined) return err(request, { code: 'unauthenticated', message: 'account authentication required', details: {} })
        const items = await userModelKeys.list({ userId: userId as never })
        return { rpcId: request.rpcId, result: { ok: true, value: { items: items } } }
      },
      async revoke(request): Promise<RpcResponse<{ revoked: boolean }>> {
        const userModelKeys = ctx.get('userModelKeys')
        if (userModelKeys === undefined) return err(request, { code: 'internal', message: 'user-model-keys service is not mounted', details: {} })
        if (request.principal?.kind === 'account') return err(request, { code: 'unauthenticated', message: 'model-key management requires a local principal', details: {} })
        try {
          const out = await userModelKeys.revoke({ keyId: request.payload.keyId as never })
          return { rpcId: request.rpcId, result: { ok: true, value: out } }
        } catch (keyErr) {
          if (isServiceError<ModelKeyError>(keyErr)) {
            return err(request, {
              code: modelKeyErrorCodeToWire(keyErr.code),
              message: keyErr.message,
              ...modelKeyErrorDetails(keyErr, request.payload.keyId),
            } as RpcError)
          }
          throw keyErr
        }
      },
    },

    artifactRegistry: {
      async list(request): Promise<RpcResponse<{ items: ArtifactRegistryView[] }>> {
        const registry = ctx.get('artifactRegistry')
        if (registry === undefined) return err(request, { code: 'internal', message: 'artifact registry is not mounted', details: {} })
        if (request.principal?.kind === 'account') {
          const sessionId = request.payload.sessionId
          if (sessionId === undefined) return err(request, { code: 'unauthenticated', message: 'artifact.list requires a session filter', details: {} })
          const denied = await authorizeSession(request, brandSessionId(sessionId))
          if (denied !== undefined) return { rpcId: request.rpcId, result: { ok: false, error: denied } }
        }
        const readonlyItems = await registry.list({
          ...(request.principal?.kind !== 'account' && request.payload.workspaceId !== undefined ? { workspaceId: brandWorkspaceId(request.payload.workspaceId) } : {}),
          ...(request.payload.sessionId !== undefined ? { sessionId: brandSessionId(request.payload.sessionId) } : {}),
        })
        const items = request.payload.kind === undefined
          ? readonlyItems
          : readonlyItems.filter(item => item.kind === request.payload.kind)
        return { rpcId: request.rpcId, result: { ok: true, value: { items: [...items] } } }
      },
      async read(request): Promise<RpcResponse<{ view: ArtifactRegistryView; bytesBase64: string }>> {
        const registry = ctx.get('artifactRegistry')
        if (registry === undefined) return err(request, { code: 'internal', message: 'artifact registry is not mounted', details: {} })
        try {
          const stored = await registry.read({ artifactId: request.payload.artifactId }, undefined)
          if (request.principal?.kind === 'account') {
            const sessionId = stored.view.sessionId
            if (sessionId === undefined || await authorizeSession(request, sessionId) !== undefined) {
              return err(request, { code: 'artifact-not-found', message: 'artifact not found', details: { artifactId: String(request.payload.artifactId) } })
            }
          }
          const bytesBase64 = Buffer.from(stored.data).toString('base64')
          return { rpcId: request.rpcId, result: { ok: true, value: { view: stored.view, bytesBase64 } } }
        } catch (artErr) {
          if (artErr instanceof ArtifactError) {
            return err(request, {
              code: artifactErrorCodeToWire(artErr.code),
              message: artErr.message,
              ...artifactErrorDetails(artErr),
            } as RpcError)
          }
          throw artErr
        }
      },
      async remove(request): Promise<RpcResponse<{ removed: true }>> {
        const registry = ctx.get('artifactRegistry')
        if (registry === undefined) return err(request, { code: 'internal', message: 'artifact registry is not mounted', details: {} })
        if (request.principal?.kind === 'account') {
          try {
            const stored = await registry.read({ artifactId: request.payload.artifactId }, undefined)
            if (stored.view.sessionId === undefined || await authorizeSession(request, stored.view.sessionId) !== undefined) {
              return err(request, { code: 'artifact-not-found', message: 'artifact not found', details: { artifactId: String(request.payload.artifactId) } })
            }
          } catch (artErr) {
            if (artErr instanceof ArtifactError) {
              return err(request, { code: 'artifact-not-found', message: 'artifact not found', details: { artifactId: String(request.payload.artifactId) } })
            }
            throw artErr
          }
        }
        // Idempotent for local callers; account callers have been ownership-checked above.
        await registry.remove({ artifactId: request.payload.artifactId })
        return { rpcId: request.rpcId, result: { ok: true, value: { removed: true as const } } }
      },
    },

    userContext: {
      async list(request) {
        const provider = ctx.get('userContext') as UserContextProvider | undefined
        if (provider === undefined) return err(request, { code: 'internal', message: 'user-context provider is not mounted', details: {} })
        const value = await provider.list(request.payload)
        return { rpcId: request.rpcId, result: { ok: true, value: { items: [...value.items] } } }
      },
      async get(request) {
        const provider = ctx.get('userContext') as UserContextProvider | undefined
        if (provider === undefined) return err(request, { code: 'internal', message: 'user-context provider is not mounted', details: {} })
        const value = await provider.get(request.payload)
        return {
          rpcId: request.rpcId,
          result: { ok: true, value: value.found ? { entry: value.entry } : { missing: true as const } },
        }
      },
      async set(request) {
        const provider = ctx.get('userContext') as UserContextProvider | undefined
        if (provider === undefined) return err(request, { code: 'internal', message: 'user-context provider is not mounted', details: {} })
        const entry = await provider.set(request.payload)
        return { rpcId: request.rpcId, result: { ok: true, value: { entry } } }
      },
      async delete(request) {
        const provider = ctx.get('userContext') as UserContextProvider | undefined
        if (provider === undefined) return err(request, { code: 'internal', message: 'user-context provider is not mounted', details: {} })
        const value = await provider.delete(request.payload)
        return { rpcId: request.rpcId, result: { ok: true, value } }
      },
    },
    accountPlugins: {
      async list(request) {
        const service = ctx.get('accountPluginFactory')
        if (service === undefined) return err(request, { code: 'internal', message: 'account plugin factory is not mounted', details: {} })
        if (request.principal?.kind !== 'account') return err(request, { code: 'unauthenticated', message: 'account authentication required', details: {} })
        const items = await service.list({ userId: request.principal.userId })
        return { rpcId: request.rpcId, result: { ok: true, value: { items } } }
      },
      async install(request) {
        return accountPluginMutation(ctx, request, 'install')
      },
      async uninstall(request) {
        return accountPluginMutation(ctx, request, 'uninstall')
      },
    },
    accountWeb: {
      async search(request, signal) {
        if (request.principal?.kind !== 'account') return err(request, { code: 'unauthenticated', message: 'account authentication required', details: {} })
        try {
          const result: WebSearchResult = await ctx.web.search(request.payload, signal)
          return { rpcId: request.rpcId, result: { ok: true, value: result } }
        } catch (error) {
          return err(request, { code: 'internal', message: error instanceof Error ? error.message : String(error), details: {} })
        }
      },
    },
    accountInference: {
      stream(request, signal): AsyncIterable<AccountInferenceFrame> {
        return (async function* (): AsyncGenerator<AccountInferenceFrame> {
          if (request.principal?.kind !== 'account') {
            yield { version: 1, type: 'error', code: 'unauthenticated', message: 'account authentication required' }
            return
          }
          const platform = ctx.get('accountPlatform') as {
            streamForAccount: (
              userId: string,
              options: GenerateOptions,
              signal: AbortSignal,
            ) => AsyncIterable<StreamChunk>
          } | undefined
          if (platform === undefined) {
            yield { version: 1, type: 'error', code: 'internal', message: 'account platform is not mounted' }
            return
          }
          try {
            const options = accountInferenceOptions(request.payload, signal)
            for await (const chunk of platform.streamForAccount(request.principal.userId, options, signal)) {
              yield { version: 1, type: 'chunk', chunk: chunk as unknown as Extract<AccountInferenceFrame, { type: 'chunk' }>['chunk'] }
            }
            yield { version: 1, type: 'done' }
          } catch (error) {
            yield { version: 1, type: 'error', code: serviceErrorCode(error) ?? 'internal', message: errorMessage(error) }
          }
        })()
      },
    },
  }
}

async function accountPluginMutation(
  ctx: Context, request: RpcRequest<{ pluginId: string }>, operation: 'install' | 'uninstall',
): Promise<RpcResponse<AccountPluginView>> {
  const service = ctx.get('accountPluginFactory')
  if (service === undefined) return err(request, { code: 'internal', message: 'account plugin factory is not mounted', details: {} })
  if (request.principal?.kind !== 'account') return err(request, { code: 'unauthenticated', message: 'account authentication required', details: {} })
  try {
    const value = await service[operation]({ userId: request.principal.userId, pluginId: request.payload.pluginId })
    return { rpcId: request.rpcId, result: { ok: true, value } }
  } catch (error) {
    if (serviceErrorCode(error) !== undefined) return err(request, { code: 'bad-request', message: errorMessage(error), details: { issues: [] } })
    throw error
  }
}

// ---- xiaowei error translation ----

/** Map identity-seam error codes to the closed wire-code union. */
function identityErrorCodeToWire(code: IdentityError['code']): RpcErrorCode {
  switch (code) {
    case 'EMAIL_TAKEN': return 'email-taken'
    case 'UNAUTHENTICATED':
    case 'SESSION_EXPIRED': return 'unauthenticated'
    case 'BAD_REQUEST': return 'bad-request'
    case 'IDENTITY_UNAVAILABLE': return 'internal'
    case 'INVITATION_REQUIRED':
    case 'INVITATION_INVALID': return 'invitation-invalid'
    case 'INVITATION_LIMIT': return 'invitation-limit'
    case 'USER_LIMIT': return 'user-limit'
  }
}

async function identityForInvitation(ctx: Context, code: string): Promise<{ invitationId: string } | undefined> {
  const identity = ctx.get('identity')
  if (identity === undefined) return undefined
  try {
    return await identity.inspectInvitation({ code })
  } catch (error) {
    if (isServiceError<IdentityError>(error)) return undefined
    throw error
  }
}

/** Map email-verification-seam error codes to the closed wire-code union. */
function emailVerificationCodeToWire(code: EmailVerificationError['code']): RpcErrorCode {
  switch (code) {
    case 'RESEND_COOLDOWN': return 'email-code-resend-cooldown'
    case 'RATE_LIMIT_EXCEEDED': return 'email-code-rate-limit'
    case 'WRONG_CODE': return 'email-code-wrong'
    case 'CODE_EXPIRED': return 'email-code-expired'
    case 'CODE_LOCKED': return 'email-code-locked'
    case 'EMAIL_VERIFICATION_DISABLED': return 'internal'
    case 'VERIFICATION_CODE_REQUIRED':
    case 'CODE_NOT_FOUND': return 'bad-request'
    case 'EMAIL_INVALID': return 'bad-request'
  }
}

/** Carry the seam's retry hint to the wire so a client UI can show the cooldown. */
function emailVerificationErrorDetails(err: EmailVerificationError): { details: { retryAfterSeconds: number } } {
  return { details: { retryAfterSeconds: err.retryAfterSeconds ?? 0 } }
}

/** Map wallet-seam error codes to the closed wire-code union. */
function walletErrorCodeToWire(code: WalletError['code']): RpcErrorCode {
  switch (code) {
    case 'INSUFFICIENT_BALANCE': return 'insufficient-balance'
    case 'DUPLICATE_REFRESH':
    case 'RESERVATION_CONFLICT':
    case 'RESERVATION_NOT_FOUND':
    case 'RESERVATION_ALREADY_SETTLED':
    case 'RESERVATION_ALREADY_CANCELLED':
    case 'RESERVATION_ACTUAL_EXCEEDS_RESERVED':
    case 'BAD_REQUEST': return 'bad-request'
    case 'WALLET_UNAVAILABLE': return 'internal'
  }
}

/** Carry the structured insufficient-balance detail to the wire. */
function walletErrorDetails(err: WalletError): { details: { userId: string; balanceMicros: number; attemptedMicros: number } | {} } {
  if (err.detail !== undefined) {
    return { details: err.detail }
  }
  return { details: {} }
}

/** Map model-key-seam error codes to the closed wire-code union. */
function modelKeyErrorCodeToWire(code: ModelKeyError['code']): RpcErrorCode {
  switch (code) {
    case 'KEY_NOT_FOUND': return 'model-key-not-found'
    case 'BAD_REQUEST': return 'bad-request'
    case 'MASTER_KEY_NOT_CONFIGURED':
    case 'MASTER_KEY_INVALID':
    case 'MODEL_KEYS_UNAVAILABLE': return 'internal'
  }
}

/** Carry the named keyId to the wire for KEY_NOT_FOUND cases. */
type ModelKeyErrorDetails =
  | { details: { keyId: string } }
  | { details: Record<string, never> }

function modelKeyErrorDetails(
  err: ModelKeyError, keyId: string | undefined,
): ModelKeyErrorDetails {
  if (err.code === 'KEY_NOT_FOUND' && keyId !== undefined) return { details: { keyId } }
  return { details: {} }
}

/** Map artifact-seam error codes to the closed wire-code union. */
function artifactErrorCodeToWire(code: ArtifactError['code']): RpcErrorCode {
  switch (code) {
    case 'ARTIFACT_NOT_FOUND': return 'artifact-not-found'
    case 'ARTIFACT_CORRUPT': return 'artifact-corrupt'
    case 'ARTIFACT_TOO_LARGE':
    case 'UNSUPPORTED_ARTIFACT_KIND':
    case 'UNSUPPORTED_ARTIFACT_SOURCE':
    case 'UNSUPPORTED_ARTIFACT_MEDIA_TYPE':
    case 'ARTIFACT_TOO_MANY_PER_SESSION':
    case 'INVALID_ARTIFACT_BYTES':
    case 'INVALID_ARTIFACT_REF': return 'artifact-corrupt'
    case 'ARTIFACT_READ_FAILED':
    case 'ARTIFACT_WRITE_FAILED':
    case 'ARTIFACT_REMOVE_FAILED': return 'internal'
  }
}

/** Carry the artifact id to the wire for the not-found case. */
function artifactErrorDetails(err: ArtifactError): { details: { artifactId: string; reason: string } | { artifactId: string } | {} } {
  const reason = err.message
  const causeRecord = (err.cause !== undefined && typeof err.cause === 'object' && err.cause !== null)
    ? err.cause as { artifactId?: string }
    : undefined
  if (err.code === 'ARTIFACT_NOT_FOUND') return { details: { artifactId: causeRecord?.artifactId ?? '' } }
  if (err.code === 'ARTIFACT_CORRUPT') {
    return { details: { artifactId: causeRecord?.artifactId ?? '', reason } }
  }
  return { details: {} }
}

/** Compact user-id projection for human-readable key labels: first 8 chars. */
function shortUserId(userId: string): string {
  return userId.replace(/^u_/, '').slice(0, 8)
}
