/** Account-owned business Skill configuration API. */

import type { RpcRequest, RpcResponse } from './rpc.ts'

/** JSON Schema object accepted in a business operation manifest. */
export type BusinessSkillJsonSchema = Record<string, unknown>

/** One read-only operation exposed by a business Skill. */
export interface BusinessSkillOperationView {
  id: string
  method: 'GET'
  path: string
  input: BusinessSkillJsonSchema
  output: BusinessSkillJsonSchema
  permission: string
  connection: string
  credentialRef?: string
  risk: 'R1'
  maxResponseBytes?: number
}

/** Data-only manifest stored for an authenticated account. */
export interface BusinessSkillManifestView {
  name: string
  version: string
  description: string
  connectionIds: string[]
  credentialRefs: string[]
  operations: BusinessSkillOperationView[]
}

/** One immutable manifest revision; account identity is intentionally omitted. */
export interface BusinessSkillVersionView {
  revision: number
  manifest: BusinessSkillManifestView
  active: boolean
}

/** Authenticated account administration for hot-loaded business Skills. */
export interface BusinessSkillsApi {
  /** List all retained revisions owned by the authenticated account. */
  list(request: RpcRequest<Record<string, never>>): Promise<RpcResponse<{ items: BusinessSkillVersionView[] }>>
  /** Validate and normalize a manifest without publishing it. */
  validate(request: RpcRequest<{ manifestText: string }>): Promise<RpcResponse<{ valid: boolean; issues: string[] }>>
  /** Publish a validated manifest as the active revision. */
  publish(request: RpcRequest<{ manifestText: string; expectedRevision?: number }>): Promise<RpcResponse<BusinessSkillVersionView>>
  /** Disable the active revision for a named Skill. */
  disable(request: RpcRequest<{ skill: string; expectedRevision?: number }>): Promise<RpcResponse<{ disabled: true }>>
  /** Make a retained revision active again. */
  rollback(
    request: RpcRequest<{ skill: string; revision: number; expectedRevision?: number }>,
  ): Promise<RpcResponse<BusinessSkillVersionView>>
}
