/**
 * RPC method registry and signature-derived generics. The map
 * registers only client-request methods (respond is a client-response, so it is absent);
 * map keys are the wire path segments (POST /api/session.list).
 */

import type { SessionsApi } from './sessions.ts'
import type { HostApi } from './host.ts'
import type { WorkspaceApi } from './workspace.ts'
import type { AgentPresetsApi } from './agent-presets.ts'
import type { SkillsApi } from './skills.ts'
import type { GoalsApi } from './goals.ts'
import type { SettingsApi } from './settings.ts'
import type { CredentialsApi } from './credentials.ts'
import type { LlmApi } from './llm.ts'
import type { SubagentsApi } from './subagents.ts'
import type { AccountApi } from './account.ts'
import type { WalletApi } from './wallet.ts'
import type { ModelKeysApi } from './model-keys.ts'
import type { CustomModelsApi } from './custom-models.ts'
import type { ArtifactsApi } from './artifacts.ts'
import type { UserContextApi } from './user-context.ts'
import type { RpcResponse } from './rpc.ts'
import type { AccountPluginsApi } from './account-plugins.ts'
import type { BusinessSkillsApi } from './business-skills.ts'
import type { AccountWebApi } from './account-web.ts'

/**
 * Method name → method signature. Signatures are the single source of truth; payload/value
 * types are always derived from here. A method may declare a trailing AbortSignal after the
 * request (command.execute): the carrier passes its request signal, never a wire field.
 */
export interface RpcMethodMap {
  'session.list': SessionsApi['list']
  'session.search': SessionsApi['search']
  'session.create': SessionsApi['create']
  'session.history': SessionsApi['history']
  'session.models': SessionsApi['models']
  'session.selectModel': SessionsApi['selectModel']
  'session.rename': SessionsApi['rename']
  'session.fork': SessionsApi['fork']
  'session.prompt': SessionsApi['prompt']
  'session.attachment': SessionsApi['attachment']
  'session.updateQueue': SessionsApi['updateQueue']
  'session.cancel': SessionsApi['cancel']
  'subagent.list': SubagentsApi['list']
  'subagent.history': SubagentsApi['history']
  'subagent.prompt': SubagentsApi['prompt']
  'subagent.interrupt': SubagentsApi['interrupt']
  'host.describe': HostApi['describe']
  'host.pickDirectory': HostApi['pickDirectory']
  'host.listDirectory': HostApi['listDirectory']
  'host.createDirectory': HostApi['createDirectory']
  'host.openPath': HostApi['openPath']
  'workspace.list': WorkspaceApi['list']
  'workspace.create': WorkspaceApi['create']
  'workspace.importDirectory': WorkspaceApi['importDirectory']
  'workspace.rename': WorkspaceApi['rename']
  'workspace.delete': WorkspaceApi['delete']
  'workspace.insertBefore': WorkspaceApi['insertBefore']
  'workspace.insertSessionBefore': WorkspaceApi['insertSessionBefore']
  'workspace.archiveSession': WorkspaceApi['archiveSession']
  'skill.list': SkillsApi['list']
  'agentPreset.list': AgentPresetsApi['list']
  'agentPreset.select': AgentPresetsApi['select']
  'agentPreset.read': AgentPresetsApi['read']
  'agentPreset.copy': AgentPresetsApi['copy']
  'agentPreset.openDocument': AgentPresetsApi['openDocument']
  'agentPreset.remove': AgentPresetsApi['remove']
  'goal.create': GoalsApi['create']
  'goal.edit': GoalsApi['edit']
  'goal.pause': GoalsApi['pause']
  'goal.resume': GoalsApi['resume']
  'goal.complete': GoalsApi['complete']
  'goal.clear': GoalsApi['clear']
  'settings.describe': SettingsApi['describe']
  'settings.openDocument': SettingsApi['openDocument']
  'settings.update': SettingsApi['update']
  'settings.replace': SettingsApi['replace']
  'settings.mutate': SettingsApi['mutate']
  'credentials.describe': CredentialsApi['describe']
  'credentials.set': CredentialsApi['set']
  'credentials.unset': CredentialsApi['unset']
  'llm.providers': LlmApi['providers']
  'llm.models': LlmApi['models']
  'llm.discoverModels': LlmApi['discoverModels']
  // ---- xiaowei multi-user account seam ----
  'account.signup': AccountApi['signup']
  'account.emailCode': AccountApi['emailCode']
  'account.invites.create': AccountApi['invites']['create']
  'account.invites.list': AccountApi['invites']['list']
  'account.invites.rotate': AccountApi['invites']['rotate']
  'account.signin': AccountApi['signin']
  'account.signout': AccountApi['signout']
  'account.state': AccountApi['state']
  'account.wallet.get': WalletApi['get']
  'account.wallet.credit': WalletApi['credit']
  'account.wallet.debit': WalletApi['debit']
  'account.wallet.setQuota': WalletApi['setQuota']
  'account.wallet.refreshDaily': WalletApi['refreshDaily']
  'account.wallet.grantWelcomeBonus': WalletApi['grantWelcomeBonus']
  'account.wallet.listLedger': WalletApi['listLedger']
  'account.modelKeys.provision': ModelKeysApi['provision']
  'account.modelKeys.list': ModelKeysApi['list']
  'account.modelKeys.revoke': ModelKeysApi['revoke']
  'account.customModels.create': CustomModelsApi['create']
  'account.customModels.list': CustomModelsApi['list']
  'account.customModels.remove': CustomModelsApi['remove']
  'artifact.list': ArtifactsApi['list']
  'artifact.read': ArtifactsApi['read']
  'artifact.remove': ArtifactsApi['remove']
  'userContext.list': UserContextApi['list']
  'userContext.get': UserContextApi['get']
  'userContext.set': UserContextApi['set']
  'userContext.delete': UserContextApi['delete']
  'account.plugins.list': AccountPluginsApi['list']
  'account.plugins.install': AccountPluginsApi['install']
  'account.plugins.uninstall': AccountPluginsApi['uninstall']
  'account.businessSkills.list': BusinessSkillsApi['list']
  'account.businessSkills.validate': BusinessSkillsApi['validate']
  'account.businessSkills.publish': BusinessSkillsApi['publish']
  'account.businessSkills.disable': BusinessSkillsApi['disable']
  'account.businessSkills.rollback': BusinessSkillsApi['rollback']
  'account.web.search': AccountWebApi['search']
}

/** Business request payload of method K (reaches through the RpcRequest narrow form to payload). */
export type RequestPayload<K extends keyof RpcMethodMap> = Parameters<RpcMethodMap[K]>[0]['payload']

/** Business return value of method K (reaches through the RpcResponse narrow form to infer the ok value of result). */
export type ResponseValue<K extends keyof RpcMethodMap> =
  Awaited<ReturnType<RpcMethodMap[K]>> extends RpcResponse<infer T> ? T : never
