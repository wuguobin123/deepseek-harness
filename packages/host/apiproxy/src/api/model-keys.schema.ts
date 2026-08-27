/**
 * account.modelKeys.* zod schemas (names derived from map keys).
 *
 * Upstream bearer tokens are never represented by these schemas.
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import type { ModelKeyView } from './model-keys.ts'

/** Wire-side opaque id brand cast (UserId, KeyId, KeyValue share the same shape). */
const opaqueIdSchema = z.string().min(1)

/** `mk_<16 hex>` row PK. */
const keyIdSchema = z.string().regex(/^mk_[a-f0-9]+$/i)

/** `sk_<base64url>` plaintext bearer. */

/** account.modelKeys.provision request payload. */
export const accountModelKeysProvisionRequestSchema = z.object({
  userId: opaqueIdSchema.optional(),
  label: z.string().min(1).max(64).optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'account.modelKeys.provision'>>>

/** account.modelKeys.provision response value. */
export const accountModelKeysProvisionValueSchema = z.object({
  keyId: keyIdSchema,
  userId: opaqueIdSchema,
  label: z.string().min(1).max(64),
  createdAt: z.number().int().positive(),
}) satisfies z.ZodType<Wire<ResponseValue<'account.modelKeys.provision'>>>

/** account.modelKeys.list request payload. */
export const accountModelKeysListRequestSchema = z.object({
  userId: opaqueIdSchema.optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'account.modelKeys.list'>>>

/** Single metadata row. */
const modelKeyViewSchema: z.ZodType<Wire<ModelKeyView>> = z.object({
  keyId: keyIdSchema,
  userId: opaqueIdSchema,
  label: z.string().min(1).max(64),
  createdAt: z.number().int().positive(),
  lastUsedAt: z.number().int().positive().nullable(),
  revokedAt: z.number().int().positive().nullable(),
  providerRoute: opaqueIdSchema,
  apiBaseUrl: z.string(),
  model: opaqueIdSchema,
  inputPriceMicrosPerToken: z.number().int().nonnegative(),
  outputPriceMicrosPerToken: z.number().int().nonnegative(),
})

/** account.modelKeys.list response value. */
export const accountModelKeysListValueSchema = z.object({
  items: z.array(modelKeyViewSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'account.modelKeys.list'>>>

/** account.modelKeys.revoke request payload. */
export const accountModelKeysRevokeRequestSchema = z.object({
  keyId: opaqueIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'account.modelKeys.revoke'>>>

/** account.modelKeys.revoke response value. */
export const accountModelKeysRevokeValueSchema = z.object({
  revoked: z.boolean(),
}) satisfies z.ZodType<Wire<ResponseValue<'account.modelKeys.revoke'>>>
