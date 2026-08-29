import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'

/** Strict account web search request; transport and account identity are not payload fields. */
export const accountWebSearchRequestSchema = z.object({
  query: z.string().min(1).max(4096),
  maxResults: z.number().int().min(1).max(100).optional(),
}).strict() satisfies z.ZodType<Wire<RequestPayload<'account.web.search'>>>

const sourceSchema = z.object({
  url: z.string().min(1), title: z.string().optional(), snippet: z.string().optional(), publishedAt: z.string().optional(),
}).strict()
/** Normalized web search result returned without account or transport metadata. */
export const accountWebSearchValueSchema = z.object({
  content: z.string().optional(), sources: z.array(sourceSchema), truncated: z.boolean(),
}).strict() satisfies z.ZodType<Wire<ResponseValue<'account.web.search'>>>
