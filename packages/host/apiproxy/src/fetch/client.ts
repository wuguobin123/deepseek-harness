/**
 * Client side of the fetch carrier. AbstractApiClient holds every protocol invariant: rpcId minting,
 * four-quadrant envelope wrap/unwrap, zod parsing, in-process SSE frame decoding, and the payload-direct
 * IApiClient domain methods (business code never mints). Platform differences ride two aspects:
 * abstract doFetch (transport) + overridable onEnvelope (tap). ApiProxy (the impl face) is untouched.
 */

import type { z } from 'zod'
import type { ApiProxy, HostFrame, MuxFrame } from '../api/index.ts'
import type { RequestPayload, ResponseValue, RpcMethodMap } from '../api/rpc-map.ts'
import type { ClientRequest, ClientResponse, RpcMessage, RpcReceipt, RpcRequest, RpcResponse, ServerRequest } from '../api/rpc.ts'
import { RpcId } from '../api/rpc.ts'
import type { Wire } from '../api/rpc.schema.ts'
import { rpcReceiptSchema, serverRequestSchema, serverResponseSchema } from '../api/rpc.schema.ts'
import { hostFrameSchema, muxFrameSchema } from '../api/events.schema.ts'
import {
  hostCreateDirectoryValueSchema, hostDescribeValueSchema,
  hostListDirectoryValueSchema, hostOpenPathValueSchema, hostPickDirectoryValueSchema,
} from '../api/host.schema.ts'
import {
  sessionCancelValueSchema,
  sessionAttachmentValueSchema,
  sessionCreateValueSchema,
  sessionForkValueSchema,
  sessionHistoryValueSchema,
  sessionListValueSchema,
  sessionModelsValueSchema,
  sessionPromptValueSchema,
  sessionRenameValueSchema,
  sessionSearchValueSchema,
  sessionSelectModelValueSchema,
  sessionUpdateQueueValueSchema,
} from '../api/sessions.schema.ts'
import {
  workspaceArchiveSessionValueSchema,
  workspaceCreateValueSchema,
  workspaceImportDirectoryValueSchema,
  workspaceDeleteValueSchema,
  workspaceInsertBeforeValueSchema,
  workspaceInsertSessionBeforeValueSchema,
  workspaceListValueSchema,
  workspaceRenameValueSchema,
} from '../api/workspace.schema.ts'
import { skillListValueSchema } from '../api/skills.schema.ts'
import {
  agentPresetCopyValueSchema, agentPresetListValueSchema, agentPresetOpenDocumentValueSchema,
  agentPresetReadValueSchema, agentPresetRemoveValueSchema, agentPresetSelectValueSchema,
} from '../api/agent-presets.schema.ts'
import {
  goalCreateValueSchema,
  goalEditValueSchema,
  goalPauseValueSchema,
  goalResumeValueSchema,
  goalCompleteValueSchema,
  goalClearValueSchema,
} from '../api/goals.schema.ts'
import {
  settingsDescribeValueSchema, settingsMutateValueSchema, settingsOpenDocumentValueSchema,
  settingsReplaceValueSchema, settingsUpdateValueSchema,
} from '../api/settings.schema.ts'
import {
  credentialsDescribeValueSchema, credentialsSetValueSchema, credentialsUnsetValueSchema,
} from '../api/credentials.schema.ts'
import { llmDiscoverModelsValueSchema, llmModelsValueSchema, llmProvidersValueSchema } from '../api/llm.schema.ts'
import {
  subagentHistoryValueSchema,
  subagentInterruptValueSchema,
  subagentListValueSchema,
  subagentPromptValueSchema,
} from '../api/subagents.schema.ts'
import {
  accountEmailCodeValueSchema, accountSigninValueSchema, accountSignoutValueSchema,
  accountSignupValueSchema, accountStateValueSchema,
  accountInvitesCreateValueSchema, accountInvitesListValueSchema, accountInvitesRotateValueSchema,
} from '../api/account.schema.ts'
import {
  accountWalletCreditValueSchema, accountWalletDebitValueSchema, accountWalletGetValueSchema,
  accountWalletGrantWelcomeBonusValueSchema, accountWalletListLedgerValueSchema,
  accountWalletRefreshDailyValueSchema, accountWalletSetQuotaValueSchema,
} from '../api/wallet.schema.ts'
import {
  accountModelKeysListValueSchema, accountModelKeysProvisionValueSchema, accountModelKeysRevokeValueSchema,
} from '../api/model-keys.schema.ts'
import { accountCustomModelsCreateValueSchema, accountCustomModelsListValueSchema, accountCustomModelsRemoveValueSchema } from '../api/custom-models.schema.ts'
import {
  artifactListValueSchema, artifactReadValueSchema, artifactRemoveValueSchema,
} from '../api/artifacts.schema.ts'
import {
  userContextListValueSchema, userContextGetValueSchema,
  userContextSetValueSchema, userContextDeleteValueSchema,
} from '../api/user-context.schema.ts'
import { accountPluginsListValueSchema, accountPluginsInstallValueSchema, accountPluginsUninstallValueSchema } from '../api/account-plugins.schema.ts'
import {
  businessSkillsDisableValueSchema, businessSkillsListValueSchema, businessSkillsPublishValueSchema,
  businessSkillsRollbackValueSchema, businessSkillsValidateValueSchema,
} from '../api/business-skills.schema.ts'
import { accountWebSearchValueSchema } from '../api/account-web.schema.ts'

/**
 * Client consumption face of the contract (shape a): same domain tree as ApiProxy, but unary
 * methods take the business payload directly — the carrier mints the rpcId and wraps the
 * envelope. Business code needing the call's rpcId reads it from the RpcResponse echo.
 * Unary methods and respond accept an optional external AbortSignal as the last parameter.
 * Bounded calls merge it with the instance timeout via AbortSignal.any; user-paced calls
 * carry only that external signal. In both cases the signal rides beside the request, never
 * on the wire, like the stream signatures.
 * Stream methods accept an optional onOpen callback: it fires once the physical transport is
 * readable (before any frame) — the "stream established" signal
 * connection controllers need for the readiness handshake. Generators are lazy, so the
 * underlying fetch (and therefore onOpen) only happens once iteration starts.
 * Relationship: ApiProxy is the narrow-form signature contract the impl side implements;
 * IApiClient is the payload-direct view clients consume; AbstractApiClient bridges the two.
 * Derived per method key from RpcMethodMap so a map row addition updates this mechanically.
 */
export interface IApiClient {
  sessions: {
    list(payload: RequestPayload<'session.list'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'session.list'>>>
    search(payload: RequestPayload<'session.search'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'session.search'>>>
    create(payload: RequestPayload<'session.create'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'session.create'>>>
    history(payload: RequestPayload<'session.history'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'session.history'>>>
    models(payload: RequestPayload<'session.models'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'session.models'>>>
    selectModel(payload: RequestPayload<'session.selectModel'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'session.selectModel'>>>
    rename(payload: RequestPayload<'session.rename'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'session.rename'>>>
    fork(payload: RequestPayload<'session.fork'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'session.fork'>>>
    prompt(payload: RequestPayload<'session.prompt'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'session.prompt'>>>
    attachment(payload: RequestPayload<'session.attachment'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'session.attachment'>>>
    updateQueue(payload: RequestPayload<'session.updateQueue'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'session.updateQueue'>>>
    cancel(payload: RequestPayload<'session.cancel'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'session.cancel'>>>
  }
  subagents: {
    list(payload: RequestPayload<'subagent.list'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'subagent.list'>>>
    history(payload: RequestPayload<'subagent.history'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'subagent.history'>>>
    prompt(payload: RequestPayload<'subagent.prompt'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'subagent.prompt'>>>
    interrupt(payload: RequestPayload<'subagent.interrupt'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'subagent.interrupt'>>>
  }
  host: {
    describe(payload: RequestPayload<'host.describe'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'host.describe'>>>
    pickDirectory(payload: RequestPayload<'host.pickDirectory'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'host.pickDirectory'>>>
    listDirectory(payload: RequestPayload<'host.listDirectory'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'host.listDirectory'>>>
    createDirectory(payload: RequestPayload<'host.createDirectory'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'host.createDirectory'>>>
    openPath(payload: RequestPayload<'host.openPath'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'host.openPath'>>>
  }
  workspace: {
    list(payload: RequestPayload<'workspace.list'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'workspace.list'>>>
    create(payload: RequestPayload<'workspace.create'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'workspace.create'>>>
    importDirectory(payload: RequestPayload<'workspace.importDirectory'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'workspace.importDirectory'>>>
    rename(payload: RequestPayload<'workspace.rename'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'workspace.rename'>>>
    delete(payload: RequestPayload<'workspace.delete'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'workspace.delete'>>>
    insertBefore(payload: RequestPayload<'workspace.insertBefore'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'workspace.insertBefore'>>>
    insertSessionBefore(payload: RequestPayload<'workspace.insertSessionBefore'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'workspace.insertSessionBefore'>>>
    archiveSession(payload: RequestPayload<'workspace.archiveSession'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'workspace.archiveSession'>>>
  }
  skills: {
    list(payload: RequestPayload<'skill.list'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'skill.list'>>>
  }
  agentPresets: {
    list(payload: RequestPayload<'agentPreset.list'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'agentPreset.list'>>>
    select(payload: RequestPayload<'agentPreset.select'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'agentPreset.select'>>>
    read(payload: RequestPayload<'agentPreset.read'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'agentPreset.read'>>>
    copy(payload: RequestPayload<'agentPreset.copy'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'agentPreset.copy'>>>
    openDocument(payload: RequestPayload<'agentPreset.openDocument'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'agentPreset.openDocument'>>>
    remove(payload: RequestPayload<'agentPreset.remove'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'agentPreset.remove'>>>
  }
  events: {
    mux(payload: Parameters<ApiProxy['events']['mux']>[0]['payload'], signal: AbortSignal, onOpen?: () => void): AsyncIterable<RpcRequest<MuxFrame>>
    host(payload: Parameters<ApiProxy['events']['host']>[0]['payload'], signal: AbortSignal, onOpen?: () => void): AsyncIterable<RpcRequest<HostFrame>>
  }
  goals: {
    create(payload: RequestPayload<'goal.create'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'goal.create'>>>
    edit(payload: RequestPayload<'goal.edit'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'goal.edit'>>>
    pause(payload: RequestPayload<'goal.pause'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'goal.pause'>>>
    resume(payload: RequestPayload<'goal.resume'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'goal.resume'>>>
    complete(payload: RequestPayload<'goal.complete'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'goal.complete'>>>
    clear(payload: RequestPayload<'goal.clear'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'goal.clear'>>>
  }
  settings: {
    describe(payload: RequestPayload<'settings.describe'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'settings.describe'>>>
    openDocument(payload: RequestPayload<'settings.openDocument'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'settings.openDocument'>>>
    update(payload: RequestPayload<'settings.update'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'settings.update'>>>
    replace(payload: RequestPayload<'settings.replace'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'settings.replace'>>>
    mutate(payload: RequestPayload<'settings.mutate'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'settings.mutate'>>>
  }
  credentials: {
    describe(payload: RequestPayload<'credentials.describe'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'credentials.describe'>>>
    set(payload: RequestPayload<'credentials.set'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'credentials.set'>>>
    unset(payload: RequestPayload<'credentials.unset'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'credentials.unset'>>>
  }
  llm: {
    providers(payload: RequestPayload<'llm.providers'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'llm.providers'>>>
    models(payload: RequestPayload<'llm.models'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'llm.models'>>>
    discoverModels(payload: RequestPayload<'llm.discoverModels'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'llm.discoverModels'>>>
  }
  /** xiaowei multi-user account seam: signup / signin / signout / state / emailCode. */
  account: {
    signup(payload: RequestPayload<'account.signup'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'account.signup'>>>
    emailCode(payload: RequestPayload<'account.emailCode'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'account.emailCode'>>>
    signin(payload: RequestPayload<'account.signin'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'account.signin'>>>
    signout(payload: RequestPayload<'account.signout'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'account.signout'>>>
    state(payload: RequestPayload<'account.state'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'account.state'>>>
    invites: {
      create(payload: RequestPayload<'account.invites.create'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'account.invites.create'>>>
      list(payload: RequestPayload<'account.invites.list'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'account.invites.list'>>>
      rotate(payload: RequestPayload<'account.invites.rotate'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'account.invites.rotate'>>>
    }
  }
  /** xiaowei wallet: get / credit / debit / setQuota / refreshDaily / grantWelcomeBonus / listLedger. */
  wallet: {
    get(payload: RequestPayload<'account.wallet.get'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'account.wallet.get'>>>
    credit(payload: RequestPayload<'account.wallet.credit'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'account.wallet.credit'>>>
    debit(payload: RequestPayload<'account.wallet.debit'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'account.wallet.debit'>>>
    setQuota(payload: RequestPayload<'account.wallet.setQuota'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'account.wallet.setQuota'>>>
    refreshDaily(payload: RequestPayload<'account.wallet.refreshDaily'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'account.wallet.refreshDaily'>>>
    grantWelcomeBonus(payload: RequestPayload<'account.wallet.grantWelcomeBonus'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'account.wallet.grantWelcomeBonus'>>>
    listLedger(payload: RequestPayload<'account.wallet.listLedger'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'account.wallet.listLedger'>>>
  }
  /** xiaowei per-user model keys: provision / list / revoke. */
  modelKeys: {
    provision(payload: RequestPayload<'account.modelKeys.provision'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'account.modelKeys.provision'>>>
    list(payload: RequestPayload<'account.modelKeys.list'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'account.modelKeys.list'>>>
    revoke(payload: RequestPayload<'account.modelKeys.revoke'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'account.modelKeys.revoke'>>>
  }
  customModels: {
    create(payload: RequestPayload<'account.customModels.create'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'account.customModels.create'>>>
    list(payload: RequestPayload<'account.customModels.list'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'account.customModels.list'>>>
    remove(payload: RequestPayload<'account.customModels.remove'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'account.customModels.remove'>>>
  }
  /** xiaowei durable artifact registry: list / read / remove. */
  artifactRegistry: {
    list(payload: RequestPayload<'artifact.list'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'artifact.list'>>>
    read(payload: RequestPayload<'artifact.read'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'artifact.read'>>>
    remove(payload: RequestPayload<'artifact.remove'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'artifact.remove'>>>
  }
  userContext: {
    list(payload: RequestPayload<'userContext.list'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'userContext.list'>>>
    get(payload: RequestPayload<'userContext.get'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'userContext.get'>>>
    set(payload: RequestPayload<'userContext.set'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'userContext.set'>>>
    delete(payload: RequestPayload<'userContext.delete'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'userContext.delete'>>>
  }
  accountPlugins: {
    list(payload: RequestPayload<'account.plugins.list'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'account.plugins.list'>>>
    install(payload: RequestPayload<'account.plugins.install'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'account.plugins.install'>>>
    uninstall(payload: RequestPayload<'account.plugins.uninstall'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'account.plugins.uninstall'>>>
  }
  businessSkills: {
    list(payload: RequestPayload<'account.businessSkills.list'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'account.businessSkills.list'>>>
    validate(payload: RequestPayload<'account.businessSkills.validate'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'account.businessSkills.validate'>>>
    publish(payload: RequestPayload<'account.businessSkills.publish'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'account.businessSkills.publish'>>>
    disable(payload: RequestPayload<'account.businessSkills.disable'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'account.businessSkills.disable'>>>
    rollback(payload: RequestPayload<'account.businessSkills.rollback'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'account.businessSkills.rollback'>>>
  }
  accountWeb: {
    search(payload: RequestPayload<'account.web.search'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'account.web.search'>>>
  }
  /** client-response passthrough (rpcId is a backfill of the server-request's id — never minted here). */
  respond(message: ClientResponse, signal?: AbortSignal): Promise<RpcReceipt>
}

/**
 * S→C second-level parse table: value schema by method (the response-path
 * mirror of the handler's request table; key coverage compiler-enforced against RpcMethodMap).
 */
const UNARY_VALUE_SCHEMAS: { [K in keyof RpcMethodMap]: z.ZodType<Wire<ResponseValue<K>>> } = {
  'session.list': sessionListValueSchema,
  'session.search': sessionSearchValueSchema,
  'session.create': sessionCreateValueSchema,
  'session.history': sessionHistoryValueSchema,
  'session.models': sessionModelsValueSchema,
  'session.selectModel': sessionSelectModelValueSchema,
  'session.rename': sessionRenameValueSchema,
  'session.fork': sessionForkValueSchema,
  'session.prompt': sessionPromptValueSchema,
  'session.attachment': sessionAttachmentValueSchema,
  'session.updateQueue': sessionUpdateQueueValueSchema,
  'session.cancel': sessionCancelValueSchema,
  'subagent.list': subagentListValueSchema,
  'subagent.history': subagentHistoryValueSchema,
  'subagent.prompt': subagentPromptValueSchema,
  'subagent.interrupt': subagentInterruptValueSchema,
  'host.describe': hostDescribeValueSchema,
  'host.pickDirectory': hostPickDirectoryValueSchema,
  'host.listDirectory': hostListDirectoryValueSchema,
  'host.createDirectory': hostCreateDirectoryValueSchema,
  'host.openPath': hostOpenPathValueSchema,
  'workspace.list': workspaceListValueSchema,
  'workspace.create': workspaceCreateValueSchema,
  'workspace.importDirectory': workspaceImportDirectoryValueSchema,
  'workspace.rename': workspaceRenameValueSchema,
  'workspace.delete': workspaceDeleteValueSchema,
  'workspace.insertBefore': workspaceInsertBeforeValueSchema,
  'workspace.insertSessionBefore': workspaceInsertSessionBeforeValueSchema,
  'workspace.archiveSession': workspaceArchiveSessionValueSchema,
  'skill.list': skillListValueSchema,
  'agentPreset.list': agentPresetListValueSchema,
  'agentPreset.select': agentPresetSelectValueSchema,
  'agentPreset.read': agentPresetReadValueSchema,
  'agentPreset.copy': agentPresetCopyValueSchema,
  'agentPreset.openDocument': agentPresetOpenDocumentValueSchema,
  'agentPreset.remove': agentPresetRemoveValueSchema,
  'goal.create': goalCreateValueSchema,
  'goal.edit': goalEditValueSchema,
  'goal.pause': goalPauseValueSchema,
  'goal.resume': goalResumeValueSchema,
  'goal.complete': goalCompleteValueSchema,
  'goal.clear': goalClearValueSchema,
  'settings.describe': settingsDescribeValueSchema,
  'settings.openDocument': settingsOpenDocumentValueSchema,
  'settings.update': settingsUpdateValueSchema,
  'settings.replace': settingsReplaceValueSchema,
  'settings.mutate': settingsMutateValueSchema,
  'credentials.describe': credentialsDescribeValueSchema,
  'credentials.set': credentialsSetValueSchema,
  'credentials.unset': credentialsUnsetValueSchema,
  'llm.providers': llmProvidersValueSchema,
  'llm.models': llmModelsValueSchema,
  'llm.discoverModels': llmDiscoverModelsValueSchema,
  // ---- xiaowei multi-user account seam ----
  'account.signup': accountSignupValueSchema,
  'account.emailCode': accountEmailCodeValueSchema,
  'account.invites.create': accountInvitesCreateValueSchema,
  'account.invites.list': accountInvitesListValueSchema,
  'account.invites.rotate': accountInvitesRotateValueSchema,
  'account.signin': accountSigninValueSchema,
  'account.signout': accountSignoutValueSchema,
  'account.state': accountStateValueSchema,
  'account.wallet.get': accountWalletGetValueSchema,
  'account.wallet.credit': accountWalletCreditValueSchema,
  'account.wallet.debit': accountWalletDebitValueSchema,
  'account.wallet.setQuota': accountWalletSetQuotaValueSchema,
  'account.wallet.refreshDaily': accountWalletRefreshDailyValueSchema,
  'account.wallet.grantWelcomeBonus': accountWalletGrantWelcomeBonusValueSchema,
  'account.wallet.listLedger': accountWalletListLedgerValueSchema,
  'account.modelKeys.provision': accountModelKeysProvisionValueSchema,
  'account.modelKeys.list': accountModelKeysListValueSchema,
  'account.modelKeys.revoke': accountModelKeysRevokeValueSchema,
  'account.customModels.create': accountCustomModelsCreateValueSchema,
  'account.customModels.list': accountCustomModelsListValueSchema,
  'account.customModels.remove': accountCustomModelsRemoveValueSchema,
  'artifact.list': artifactListValueSchema,
  'artifact.read': artifactReadValueSchema,
  'artifact.remove': artifactRemoveValueSchema,
  'userContext.list': userContextListValueSchema,
  'userContext.get': userContextGetValueSchema,
  'userContext.set': userContextSetValueSchema,
  'userContext.delete': userContextDeleteValueSchema,
  'account.plugins.list': accountPluginsListValueSchema,
  'account.plugins.install': accountPluginsInstallValueSchema,
  'account.plugins.uninstall': accountPluginsUninstallValueSchema,
  'account.businessSkills.list': businessSkillsListValueSchema,
  'account.businessSkills.validate': businessSkillsValidateValueSchema,
  'account.businessSkills.publish': businessSkillsPublishValueSchema,
  'account.businessSkills.disable': businessSkillsDisableValueSchema,
  'account.businessSkills.rollback': businessSkillsRollbackValueSchema,
  'account.web.search': accountWebSearchValueSchema,
}

/** Default timeout for bounded unary calls (rpc-compare 2026-07-19: a hung host must not leave callers pending forever). */
const DEFAULT_TIMEOUT_MS = 30_000

/** Whether a unary call uses the transport health deadline or only caller/connection cancellation. */
type UnaryTimeoutPolicy = 'default' | 'caller-signal-only'

/** URL base for in-process handler injection (fake authority, opencode precedent). */
const INTERNAL_BASE = 'http://dsh.internal'

/** Redact write-only secrets before an outgoing request reaches diagnostics observers. */
function observableClientRequest(message: ClientRequest): ClientRequest {
  if (message.method !== 'account.customModels.create') return message
  const payload = message.payload as RequestPayload<'account.customModels.create'>
  return { ...message, payload: { ...payload, apiKey: '[redacted]' } }
}

/**
 * Abstract fetch-carrier client. Subclasses supply the transport (doFetch) and may refine the
 * per-message tap (onEnvelope) — platform aspects stay in subclasses, protocol invariants stay
 * here. Envelope observation is a first-class aspect of this data middle layer: the instance
 * owns a microtask-batched buffer (frame storms must not cost one consumer update per frame),
 * and observers subscribe via subscribeEnvelopes. The isomorphic point survives: an in-process
 * subclass whose doFetch is toFetchHandler(api).fetch never touches the network.
 */
export abstract class AbstractApiClient implements IApiClient {
  /** Instance-owned observation buffer (module-level state would leak across instances/tests). */
  private envelopeBatch: RpcMessage[] = []
  private flushScheduled = false
  private readonly envelopeListeners = new Set<(batch: readonly RpcMessage[]) => void>()

  /** @param timeoutMs - timeout for bounded unary calls; user-paced calls and streams do not use it. */
  constructor(protected readonly timeoutMs: number = DEFAULT_TIMEOUT_MS) {}

  /** Transport aspect: browser fetch, injected handler.fetch, IPC bridge, ... */
  protected abstract doFetch(input: URL, init?: RequestInit): Promise<Response>

  /**
   * Subscribe to batched envelope observation (diagnostics/logging consumers).
   * Batches follow microtask boundaries; a listener throw is isolated (observation
   * must never break the carrier).
   * @param listener - receives each flushed batch in arrival order.
   * @returns unsubscribe function.
   */
  subscribeEnvelopes(listener: (batch: readonly RpcMessage[]) => void): () => void {
    this.envelopeListeners.add(listener)
    return () => {
      this.envelopeListeners.delete(listener)
    }
  }

  /** Per-message tap: feeds the instance buffer. Subclasses may override to observe unbatched (call super to keep batching). */
  protected onEnvelope(message: RpcMessage): void {
    if (this.envelopeListeners.size === 0) return
    this.envelopeBatch.push(message)
    if (this.flushScheduled) return
    this.flushScheduled = true
    queueMicrotask(() => {
      this.flushScheduled = false
      // Never empty here: a flush is only ever scheduled by the push above,
      // and this callback is the sole drain point.
      const batch = this.envelopeBatch
      this.envelopeBatch = []
      for (const notify of this.envelopeListeners) {
        try {
          notify(batch)
        } catch (error) {
          console.error('[apiproxy] envelope listener threw:', error)
        }
      }
    })
  }

  /** Browser = same-origin (a fake authority would fail DNS on real requests); no-location env (Node) = fake authority. */
  protected resolveBase(): string {
    const loc = (globalThis as { location?: { origin?: string } }).location
    return loc?.origin !== undefined && loc.origin !== 'null' ? loc.origin : INTERNAL_BASE
  }

  protected mintRpcId(): RpcId {
    // crypto.randomUUID is a Web API (browser + Node ≥19): keeps this base platform-neutral.
    return RpcId(crypto.randomUUID())
  }

  /**
   * Shared POST leg of both C→S carriers (callUnary/respond): JSON body,
   * optional default timeout merged with the caller's external signal, non-2xx → transport throw.
   */
  private async postJson(
    path: string,
    body: ClientRequest | ClientResponse,
    signal: AbortSignal | undefined,
    timeoutPolicy: UnaryTimeoutPolicy = 'default',
  ): Promise<Response> {
    const requestSignal = timeoutPolicy === 'default'
      ? signal === undefined
        ? AbortSignal.timeout(this.timeoutMs)
        : AbortSignal.any([AbortSignal.timeout(this.timeoutMs), signal])
      : signal
    const response = await this.doFetch(new URL(path, this.resolveBase()), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      ...requestSignal === undefined ? {} : { signal: requestSignal },
    })
    if (!response.ok) throw new Error(`transport failure for ${path}: HTTP ${response.status}`)
    return response
  }

  /**
   * Unary protocol path: mint → tap → POST full form → envelope parse → verify
   * echo → value parse → tap → narrow. Virtual so a fake carrier (fixture) can
   * override transport at this layer.
   */
  protected async callUnary<K extends keyof RpcMethodMap>(
    method: K,
    payload: RequestPayload<K>,
    signal?: AbortSignal,
    timeoutPolicy: UnaryTimeoutPolicy = 'default',
  ): Promise<RpcResponse<ResponseValue<K>>> {
    const message: ClientRequest = { type: 'client-request', rpcId: this.mintRpcId(), method, payload }
    this.onEnvelope(observableClientRequest(message))
    const response = await this.postJson(`/api/${method}`, message, signal, timeoutPolicy)
    const full = serverResponseSchema.parse(await response.json())
    this.onEnvelope(full)
    if (full.rpcId !== message.rpcId) throw new Error(`rpcId mismatch for ${method}: sent ${message.rpcId}, got ${full.rpcId}`)
    if (!full.result.ok) return { rpcId: full.rpcId, result: full.result }
    // Second-level S→C parse: the ok value must match the method's Value schema (mirror of the
    // handler's request-payload parse). The cast collapses the Wire<> widening, same as the handler side.
    const value = UNARY_VALUE_SCHEMAS[method].parse(full.result.value) as ResponseValue<K>
    return { rpcId: full.rpcId, result: { ok: true, value } }
  }

  /** Mux stream opener; virtual for the same override reason as callUnary. */
  protected openMux(_payload: Parameters<ApiProxy['events']['mux']>[0]['payload'], signal: AbortSignal, onOpen?: () => void): AsyncIterable<RpcRequest<MuxFrame>> {
    return this.readSse('/api/events.mux', signal, muxFrameSchema, onOpen)
  }

  /** Host stream opener; virtual. */
  protected openHost(_payload: Parameters<ApiProxy['events']['host']>[0]['payload'], signal: AbortSignal, onOpen?: () => void): AsyncIterable<RpcRequest<HostFrame>> {
    return this.readSse('/api/events.host', signal, hostFrameSchema, onOpen)
  }

  /**
   * SSE protocol path: streaming fetch (not EventSource), '\n\n' framing, ServerRequest envelope +
   * frame-schema parse, tap, narrow yield. onOpen fires once the response headers are in and the
   * body is readable — the stream-established signal, before any frame arrives. A frame that fails
   * either parse level is reported and skipped (one corrupt frame must not kill the stream; the
   * client's gap detection covers whatever the frame carried).
   */
  protected async *readSse<F extends MuxFrame | HostFrame>(
    path: string,
    signal: AbortSignal,
    frameSchema: z.ZodType<F>,
    onOpen?: () => void,
  ): AsyncGenerator<RpcRequest<F>> {
    const response = await this.doFetch(new URL(path, this.resolveBase()), { signal })
    if (!response.ok || response.body === null) throw new Error(`transport failure for ${path}: HTTP ${response.status}`)
    onOpen?.()
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) return
        buffer += decoder.decode(value, { stream: true })
        let boundary: number
        while ((boundary = buffer.indexOf('\n\n')) !== -1) {
          const chunk = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          const data = chunk.split('\n').filter(line => line.startsWith('data: ')).map(line => line.slice(6)).join('')
          if (data === '') continue
          let full: ServerRequest
          let frame: F
          try {
            full = serverRequestSchema.parse(JSON.parse(data))
            frame = frameSchema.parse(full.payload)
          } catch (error) {
            console.error(`[apiproxy] dropping malformed SSE frame on ${path}:`, error)
            continue
          }
          this.onEnvelope(full)
          yield { rpcId: full.rpcId, payload: frame }
        }
      }
    } finally {
      await reader.cancel().catch(() => undefined)
    }
  }

  // ---- IApiClient API (arrow properties so destructured/passed references stay bound) ----

  readonly sessions: IApiClient['sessions'] = {
    list: (payload, signal) => this.callUnary('session.list', payload, signal),
    search: (payload, signal) => this.callUnary('session.search', payload, signal),
    create: (payload, signal) => this.callUnary('session.create', payload, signal),
    history: (payload, signal) => this.callUnary('session.history', payload, signal),
    models: (payload, signal) => this.callUnary('session.models', payload, signal),
    selectModel: (payload, signal) => this.callUnary('session.selectModel', payload, signal),
    rename: (payload, signal) => this.callUnary('session.rename', payload, signal),
    fork: (payload, signal) => this.callUnary('session.fork', payload, signal),
    prompt: (payload, signal) => this.callUnary('session.prompt', payload, signal),
    attachment: (payload, signal) => this.callUnary('session.attachment', payload, signal),
    updateQueue: (payload, signal) => this.callUnary('session.updateQueue', payload, signal),
    cancel: (payload, signal) => this.callUnary('session.cancel', payload, signal),
  }

  readonly subagents: IApiClient['subagents'] = {
    list: (payload, signal) => this.callUnary('subagent.list', payload, signal),
    history: (payload, signal) => this.callUnary('subagent.history', payload, signal),
    prompt: (payload, signal) => this.callUnary('subagent.prompt', payload, signal),
    interrupt: (payload, signal) => this.callUnary('subagent.interrupt', payload, signal),
  }

  readonly host: IApiClient['host'] = {
    describe: (payload, signal) => this.callUnary('host.describe', payload, signal),
    // A native system dialog is user-paced and may legitimately stay open
    // longer than the normal unary deadline. Caller/connection aborts remain.
    pickDirectory: (payload, signal) => this.callUnary(
      'host.pickDirectory', payload, signal, 'caller-signal-only',
    ),
    listDirectory: (payload, signal) => this.callUnary('host.listDirectory', payload, signal),
    createDirectory: (payload, signal) => this.callUnary('host.createDirectory', payload, signal),
    openPath: (payload, signal) => this.callUnary('host.openPath', payload, signal),
  }

  readonly workspace: IApiClient['workspace'] = {
    list: (payload, signal) => this.callUnary('workspace.list', payload, signal),
    create: (payload, signal) => this.callUnary('workspace.create', payload, signal),
    importDirectory: (payload, signal) => this.callUnary('workspace.importDirectory', payload, signal),
    rename: (payload, signal) => this.callUnary('workspace.rename', payload, signal),
    delete: (payload, signal) => this.callUnary('workspace.delete', payload, signal),
    insertBefore: (payload, signal) => this.callUnary('workspace.insertBefore', payload, signal),
    insertSessionBefore: (payload, signal) => this.callUnary('workspace.insertSessionBefore', payload, signal),
    archiveSession: (payload, signal) => this.callUnary('workspace.archiveSession', payload, signal),
  }

  readonly skills: IApiClient['skills'] = {
    list: (payload, signal) => this.callUnary('skill.list', payload, signal),
  }

  // Annotated like every sibling, and load-bearing rather than cosmetic:
  // inferring this member inlines `AgentPresetEntry` into the emitted
  // declaration by the specifier TS picks — the host `index.ts` — which drags
  // the whole gateway, and with it the host `Context` merges, into every
  // Client program that imports this carrier.
  readonly agentPresets: IApiClient['agentPresets'] = {
    list: (payload, signal) => this.callUnary('agentPreset.list', payload, signal),
    select: (payload, signal) => this.callUnary('agentPreset.select', payload, signal),
    read: (payload, signal) => this.callUnary('agentPreset.read', payload, signal),
    copy: (payload, signal) => this.callUnary('agentPreset.copy', payload, signal),
    openDocument: (payload, signal) => this.callUnary('agentPreset.openDocument', payload, signal),
    remove: (payload, signal) => this.callUnary('agentPreset.remove', payload, signal),
  }

  readonly goals: IApiClient['goals'] = {
    create: (payload, signal) => this.callUnary('goal.create', payload, signal),
    edit: (payload, signal) => this.callUnary('goal.edit', payload, signal),
    pause: (payload, signal) => this.callUnary('goal.pause', payload, signal),
    resume: (payload, signal) => this.callUnary('goal.resume', payload, signal),
    complete: (payload, signal) => this.callUnary('goal.complete', payload, signal),
    clear: (payload, signal) => this.callUnary('goal.clear', payload, signal),
  }

  readonly settings: IApiClient['settings'] = {
    describe: (payload, signal) => this.callUnary('settings.describe', payload, signal),
    openDocument: (payload, signal) => this.callUnary('settings.openDocument', payload, signal),
    update: (payload, signal) => this.callUnary('settings.update', payload, signal),
    replace: (payload, signal) => this.callUnary('settings.replace', payload, signal),
    mutate: (payload, signal) => this.callUnary('settings.mutate', payload, signal),
  }

  readonly credentials: IApiClient['credentials'] = {
    describe: (payload, signal) => this.callUnary('credentials.describe', payload, signal),
    set: (payload, signal) => this.callUnary('credentials.set', payload, signal),
    unset: (payload, signal) => this.callUnary('credentials.unset', payload, signal),
  }

  readonly llm: IApiClient['llm'] = {
    providers: (payload, signal) => this.callUnary('llm.providers', payload, signal),
    models: (payload, signal) => this.callUnary('llm.models', payload, signal),
    discoverModels: (payload, signal) => this.callUnary('llm.discoverModels', payload, signal),
  }

  readonly account: IApiClient['account'] = {
    signup: (payload, signal) => this.callUnary('account.signup', payload, signal),
    emailCode: (payload, signal) => this.callUnary('account.emailCode', payload, signal, 'caller-signal-only'),
    invites: {
      create: (payload, signal) => this.callUnary('account.invites.create', payload, signal),
      list: (payload, signal) => this.callUnary('account.invites.list', payload, signal),
      rotate: (payload, signal) => this.callUnary('account.invites.rotate', payload, signal),
    },
    signin: (payload, signal) => this.callUnary('account.signin', payload, signal),
    signout: (payload, signal) => this.callUnary('account.signout', payload, signal),
    state: (payload, signal) => this.callUnary('account.state', payload, signal),
  }

  readonly accountPlugins: IApiClient['accountPlugins'] = {
    list: (payload, signal) => this.callUnary('account.plugins.list', payload, signal),
    install: (payload, signal) => this.callUnary('account.plugins.install', payload, signal),
    uninstall: (payload, signal) => this.callUnary('account.plugins.uninstall', payload, signal),
  }

  readonly businessSkills: IApiClient['businessSkills'] = {
    list: (payload, signal) => this.callUnary('account.businessSkills.list', payload, signal),
    validate: (payload, signal) => this.callUnary('account.businessSkills.validate', payload, signal),
    publish: (payload, signal) => this.callUnary('account.businessSkills.publish', payload, signal),
    disable: (payload, signal) => this.callUnary('account.businessSkills.disable', payload, signal),
    rollback: (payload, signal) => this.callUnary('account.businessSkills.rollback', payload, signal),
  }

  readonly accountWeb: IApiClient['accountWeb'] = {
    search: (payload, signal) => this.callUnary('account.web.search', payload, signal),
  }

  readonly wallet: IApiClient['wallet'] = {
    get: (payload, signal) => this.callUnary('account.wallet.get', payload, signal),
    credit: (payload, signal) => this.callUnary('account.wallet.credit', payload, signal),
    debit: (payload, signal) => this.callUnary('account.wallet.debit', payload, signal),
    setQuota: (payload, signal) => this.callUnary('account.wallet.setQuota', payload, signal),
    refreshDaily: (payload, signal) => this.callUnary('account.wallet.refreshDaily', payload, signal),
    grantWelcomeBonus: (payload, signal) => this.callUnary('account.wallet.grantWelcomeBonus', payload, signal),
    listLedger: (payload, signal) => this.callUnary('account.wallet.listLedger', payload, signal),
  }

  readonly modelKeys: IApiClient['modelKeys'] = {
    provision: (payload, signal) => this.callUnary('account.modelKeys.provision', payload, signal),
    list: (payload, signal) => this.callUnary('account.modelKeys.list', payload, signal),
    revoke: (payload, signal) => this.callUnary('account.modelKeys.revoke', payload, signal),
  }
  readonly customModels: IApiClient['customModels'] = {
    create: (payload, signal) => this.callUnary('account.customModels.create', payload, signal),
    list: (payload, signal) => this.callUnary('account.customModels.list', payload, signal),
    remove: (payload, signal) => this.callUnary('account.customModels.remove', payload, signal),
  }

  readonly artifactRegistry: IApiClient['artifactRegistry'] = {
    list: (payload, signal) => this.callUnary('artifact.list', payload, signal),
    read: (payload, signal) => this.callUnary('artifact.read', payload, signal),
    remove: (payload, signal) => this.callUnary('artifact.remove', payload, signal),
  }

  readonly userContext: IApiClient['userContext'] = {
    list: (payload, signal) => this.callUnary('userContext.list', payload, signal),
    get: (payload, signal) => this.callUnary('userContext.get', payload, signal),
    set: (payload, signal) => this.callUnary('userContext.set', payload, signal),
    delete: (payload, signal) => this.callUnary('userContext.delete', payload, signal),
  }

  readonly events: IApiClient['events'] = {
    mux: (payload, signal, onOpen) => this.openMux(payload, signal, onOpen),
    host: (payload, signal, onOpen) => this.openHost(payload, signal, onOpen),
  }

  async respond(message: ClientResponse, signal?: AbortSignal): Promise<RpcReceipt> {
    this.onEnvelope(message)
    const response = await this.postJson('/api/respond', message, signal)
    return rpcReceiptSchema.parse(await response.json())
  }
}

/**
 * In-process client over an injected fetch-shaped handler (the isomorphic point:
 * `new InProcessApiClient(toFetchHandler(api))` never touches the network). Lives here because
 * in-process injection is this package's own capability (handler and client are both local).
 */
export class InProcessApiClient extends AbstractApiClient {
  constructor(private readonly handler: { fetch: typeof fetch }, timeoutMs?: number) {
    super(timeoutMs)
  }

  /**
   * Faithful to real fetch: reject on signal abort even when the in-process
   * handler ignores the signal (a hung impl must not defeat timeout/cancel).
   */
  protected doFetch(input: URL, init?: RequestInit): Promise<Response> {
    const signal = init?.signal ?? undefined
    if (signal === undefined) return this.handler.fetch(input, init)
    if (signal.aborted) return Promise.reject(abortError(signal))
    return new Promise((resolve, reject) => {
      const onAbort = (): void => { reject(abortError(signal)) }
      signal.addEventListener('abort', onAbort, { once: true })
      this.handler.fetch(input, init)
        .then(resolve, reject)
        .finally(() => { signal.removeEventListener('abort', onAbort) })
    })
  }
}

/** Mirror fetch's abort rejection: the signal's reason when present, else a DOMException-style AbortError. */
function abortError(signal: AbortSignal): Error {
  const reason: unknown = signal.reason
  if (reason instanceof Error) return reason
  if (typeof reason === 'string') return new Error(reason)
  return new Error('This operation was aborted')
}
