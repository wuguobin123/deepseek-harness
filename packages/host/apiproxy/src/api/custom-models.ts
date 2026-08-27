import type { RpcRequest, RpcResponse } from './rpc.ts'

/** Opaque identifier for an account-owned custom model. */
export type CustomModelId = string

/** Metadata returned for an account-owned custom model. */
export interface CustomModelView {
  customModelId: CustomModelId
  label: string
  api: 'openai-completions' | 'openai-responses'
  baseURL: string
  upstreamModel: string
  created: number
  revoked: number | null
}

/** Account custom-model management methods. API keys only occur in create requests. */
export interface CustomModelsApi {
  /** Create one model for the authenticated account; the key is write-only. */
  create(request: RpcRequest<{
    label: string
    api: 'openai-completions' | 'openai-responses'
    baseURL: string
    upstreamModel: string
    apiKey: string
  }>): Promise<RpcResponse<CustomModelView>>
  /** List metadata owned by the authenticated account. */
  list(request: RpcRequest<Record<string, never>>): Promise<RpcResponse<{ items: CustomModelView[] }>>
  /** Revoke an owned active model by opaque id. */
  remove(request: RpcRequest<{ customModelId: CustomModelId }>): Promise<RpcResponse<{ removed: boolean }>>
}
