/**
 * user-context domain zod schemas (names derived from map keys). The
 * UserContextKey brand cast lives here (see the note in workspace.schema.ts).
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import type { UserContextView } from './user-context.ts'

/** Brand cast: a non-empty string accepted as UserContextKey. */
export const userContextKeySchema = z.string().min(1).max(128) as unknown as z.ZodType<import('./user-context.ts').UserContextKey>

/** Wire schema for reserved user-context categories. */
export const userContextKindSchema = z.enum(['preference', 'working', 'profile'])

/** Optional workspaceId accepts `null`, an explicit string, or `undefined`. */
export const userContextWorkspaceIdSchema = z.union([
  z.string().min(1).max(128),
  z.null(),
])

/** One memory row carried by every userContext.* response. */
export const userContextViewSchema = z.object({
  kind: userContextKindSchema,
  key: userContextKeySchema,
  workspaceId: userContextWorkspaceIdSchema.nullable(),
  value: z.string().max(16 * 1024),
  updatedAt: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
}) satisfies z.ZodType<Wire<UserContextView>>

/** userContext.list request payload (all fields optional). */
export const userContextListRequestSchema = z.object({
  kind: userContextKindSchema.optional(),
  workspaceId: userContextWorkspaceIdSchema.optional(),
  limit: z.number().int().positive().max(1000).optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'userContext.list'>>>

/** userContext.list response value. */
export const userContextListValueSchema = z.object({
  items: z.array(userContextViewSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'userContext.list'>>>

/** userContext.get request payload (kind + key required; workspaceId optional). */
export const userContextGetRequestSchema = z.object({
  kind: userContextKindSchema,
  key: userContextKeySchema,
  workspaceId: userContextWorkspaceIdSchema.optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'userContext.get'>>>

/** userContext.get response value: either an entry or `{ missing: true }`. */
export const userContextGetValueSchema = z.union([
  z.object({ entry: userContextViewSchema }),
  z.object({ missing: z.literal(true) }),
]) satisfies z.ZodType<Wire<ResponseValue<'userContext.get'>>>

/** userContext.set request payload (value required; workspaceId optional). */
export const userContextSetRequestSchema = z.object({
  kind: userContextKindSchema,
  key: userContextKeySchema,
  workspaceId: userContextWorkspaceIdSchema.optional(),
  value: z.string().min(0).max(16 * 1024),
}) satisfies z.ZodType<Wire<RequestPayload<'userContext.set'>>>

/** userContext.set response value. */
export const userContextSetValueSchema = z.object({
  entry: userContextViewSchema,
}) satisfies z.ZodType<Wire<ResponseValue<'userContext.set'>>>

/** userContext.delete request payload. */
export const userContextDeleteRequestSchema = z.object({
  kind: userContextKindSchema,
  key: userContextKeySchema,
  workspaceId: userContextWorkspaceIdSchema.optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'userContext.delete'>>>

/** userContext.delete response value. */
export const userContextDeleteValueSchema = z.object({
  removed: z.boolean(),
}) satisfies z.ZodType<Wire<ResponseValue<'userContext.delete'>>>
