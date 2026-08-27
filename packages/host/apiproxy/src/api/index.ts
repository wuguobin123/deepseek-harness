/**
 * apiproxy contract-layer barrel. api/ has zero Node dependencies and is
 * importable from the browser; the TS interfaces are the authoritative contract, while HTTP,
 * WebSocket, and in-process SSE are merely physical channels (four-quadrant message model).
 */

import type { SessionsApi } from './sessions.ts'
import type { HostApi } from './host.ts'
import type { WorkspaceApi } from './workspace.ts'
import type { AgentPresetsApi } from './agent-presets.ts'
import type { SkillsApi } from './skills.ts'
import type { SubagentsApi } from './subagents.ts'
import type { EventsApi } from './events.ts'
import type { GoalsApi } from './goals.ts'
import type { SettingsApi } from './settings.ts'
import type { CredentialsApi } from './credentials.ts'
import type { LlmApi } from './llm.ts'
import type { DownloadsApi } from './downloads.ts'
import type { AccountApi } from './account.ts'
import type { WalletApi } from './wallet.ts'
import type { ModelKeysApi } from './model-keys.ts'
import type { CustomModelsApi } from './custom-models.ts'
import type { ArtifactsApi } from './artifacts.ts'
import type { UserContextApi } from './user-context.ts'
import type { AccountPluginsApi } from './account-plugins.ts'
import type { ClientResponse, RpcPrincipal, RpcReceipt } from './rpc.ts'
import type { AccountInferenceApi } from './account-inference.ts'
export type { AccountInferenceApi } from './account-inference.ts'
export type { AccountInferenceMessage, AccountInferenceRequest, AccountInferenceFrame } from '@deepseek-ai/dsh-llm-account-inference'
export { ACCOUNT_INFERENCE_VERSION, accountInferenceRequestSchema, parseAccountInferenceRequest, accountInferenceFrameSchema, parseAccountInferenceFrame, parseAccountInferenceFrames } from '@deepseek-ai/dsh-llm-account-inference'

/** Root interface of the unified API. New client-request domain = one new file pair + one field here + one map row. */
export interface ApiProxy {
  sessions: SessionsApi
  subagents: SubagentsApi
  host: HostApi
  workspace: WorkspaceApi
  skills: SkillsApi
  agentPresets: AgentPresetsApi
  events: EventsApi
  goals: GoalsApi
  settings: SettingsApi
  credentials: CredentialsApi
  llm: LlmApi
  /** Host-only download surfaces (GET, no wire envelope); absent from IApiClient. */
  downloads: DownloadsApi
  /**
   * xiaowei multi-user account seam: signup / signin / signout / state, plus
   * email-verification code minting. Non-privileged — anonymous LAN callers
   * may hit signup, signin, and emailCode to grow the user base.
   */
  account: AccountApi
  /** xiaowei wallet: balance, ledger, debit/credit/setQuota/refresh-daily.
   *  The fence restricts credit/debit/setQuota/refreshDaily/grantWelcomeBonus
   *  to loopback; get and listLedger are loopback OR bearer. */
  wallet: WalletApi
  /** xiaowei per-user model keys: provision/list/revoke. */
  modelKeys: ModelKeysApi
  customModels: CustomModelsApi
  /** xiaowei durable artifact registry: list/read/remove. */
  artifactRegistry: ArtifactsApi
  userContext: UserContextApi
  accountPlugins: AccountPluginsApi
  /** Session-free account-owned model inference stream. */
  accountInference: AccountInferenceApi
  /**
   * Response entry for server requests; not a domain method.
   * @param message - Client response carrying the server request's rpcId.
   * @param principal - authenticated carrier identity, when one is required.
   * @returns Transport receipt for the response delivery.
   */
  respond(message: ClientResponse, principal?: RpcPrincipal): Promise<RpcReceipt>
}

// ---- Domain interfaces and payload entities ----
export type {
  HistoryEntry, ModelCatalogFailure, ModelCatalogModel, ModelProviderGroup, ModelReasoning,
  ModelReasoningEffort, ModelSelection, PromptContentPart, QueueAction, SessionModels,
  SessionListMetadata, SessionProjectionsBlock, SessionSearchItem, SessionsApi, SessionSummary,
} from './sessions.ts'
export type { DirectoryEntry, DirectoryListing, HostApi } from './host.ts'
export type {
  SubagentAddress, SubagentCatalog, SubagentInterruptReceipt, SubagentListEntry,
  SubagentPromptReceipt, SubagentsApi,
} from './subagents.ts'
export type { JobView } from './jobs.ts'
export type { WorkspaceApi, WorkspaceId, WorkspaceView } from './workspace.ts'
export type { SkillsApi, SkillEntry } from './skills.ts'
export type { AgentPresetsApi, AgentPresetEntry } from './agent-presets.ts'
export type { EventsApi, MuxFrame, HostFrame, QueuedInboxItem, ToolCallView, ToolEventView, ToolResultView } from './events.ts'
export type { GoalsApi, GoalId, GoalRef } from './goals.ts'
export type { SettingsApi, SettingsNamespaceView, SettingsPathOpView, SettingsSecretView } from './settings.ts'
export type { CredentialsApi, CredentialView } from './credentials.ts'
export type { ConfigurableProviderView, DiscoveredModelView, LlmApi } from './llm.ts'
export type { DownloadsApi } from './downloads.ts'
export type {
  AccountApi, SignedIn, AuthenticatedView,
} from './account.ts'
export type {
  WalletApi, WalletView, LedgerEntry, WalletLedgerReason, AmountMicros, InsufficientBalanceReason,
} from './wallet.ts'
export type { ModelKeysApi, ModelKeyView, ProvisionedKey } from './model-keys.ts'
export type { CustomModelsApi, CustomModelId, CustomModelView } from './custom-models.ts'
export type {
  ArtifactsApi, ArtifactView, ArtifactKind, ArtifactSource, ArtifactMediaType,
} from './artifacts.ts'
export type { UserContextApi, UserContextKey, UserContextKind, UserContextView } from './user-context.ts'
export type { AccountPluginsApi } from './account-plugins.ts'
export type { ApprovalResponsePayload } from './approvals.ts'

export type { QuestionResponsePayload } from './questions.ts'

// ---- Message layer: narrow forms (domain-signature view) ----
export type { RpcPrincipal, RpcRequest, RpcResponse } from './rpc.ts'

// ---- Message layer: the four wire full forms + carrier receipt ----
export type {
  ClientRequest,
  ClientResponse,
  RpcMessage,
  RpcReceipt,
  ServerRequest,
  ServerResponse,
} from './rpc.ts'

// ---- Errors and ids ----
export { RpcId, transportError } from './rpc.ts'
export type { RpcError, RpcErrorCode, RpcErrorDetailsMap, RpcResult } from './rpc.ts'
export {
  clientRequestSchema,
  serverRequestSchema,
  serverResponseSchema,
} from './rpc.schema.ts'

// ---- Fixed session-search product bounds ----
export {
  SESSION_SEARCH_RESULT_LIMIT,
  SESSION_SEARCH_SNIPPET_MAX_CODE_POINTS,
} from './session-search.ts'

// ---- Method registry and derived generics ----
export type { RequestPayload, ResponseValue, RpcMethodMap } from './rpc-map.ts'
