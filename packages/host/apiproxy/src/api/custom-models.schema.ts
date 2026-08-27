import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import type { CustomModelView } from './custom-models.ts'
const id = z.string().regex(/^cm_[a-f0-9]{16}$/)
const view: z.ZodType<Wire<CustomModelView>> = z.object({
  customModelId: id,
  label: z.string().min(1).max(64),
  api: z.enum(['openai-completions', 'openai-responses']),
  baseURL: z.url(),
  upstreamModel: z.string().min(1).max(128),
  created: z.number().int().positive(),
  revoked: z.number().int().positive().nullable(),
})
/** Schema for creating an account-owned custom model. */
export const accountCustomModelsCreateRequestSchema = z.object({
  label: z.string().min(1).max(64),
  api: z.enum(['openai-completions', 'openai-responses']),
  baseURL: z.url().max(2048),
  upstreamModel: z.string().min(1).max(128),
  apiKey: z.string().min(1).max(4096),
}) satisfies z.ZodType<Wire<RequestPayload<'account.customModels.create'>>>
/** Schema for the created custom-model response. */
export const accountCustomModelsCreateValueSchema = view satisfies z.ZodType<Wire<ResponseValue<'account.customModels.create'>>>
/** Schema for listing account-owned custom models. */
export const accountCustomModelsListRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'account.customModels.list'>>>
/** Schema for the custom-model list response. */
export const accountCustomModelsListValueSchema = z.object({ items: z.array(view) }) satisfies z.ZodType<Wire<ResponseValue<'account.customModels.list'>>>
/** Schema for removing an account-owned custom model. */
export const accountCustomModelsRemoveRequestSchema = z.object({ customModelId: id }) satisfies z.ZodType<Wire<RequestPayload<'account.customModels.remove'>>>
/** Schema for the removal response. */
export const accountCustomModelsRemoveValueSchema = z.object({ removed: z.boolean() }) satisfies z.ZodType<Wire<ResponseValue<'account.customModels.remove'>>>
