/**
 * artifact domain zod schemas (names derived from map keys). The ArtifactId
 * brand cast lives here (see the note in workspace.schema.ts).
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import type { ArtifactView } from './artifacts.ts'
import { sessionIdSchema } from './sessions.schema.ts'
import { workspaceIdSchema } from './workspace.schema.ts'

/** Brand cast: a sha256-prefixed string accepted as ArtifactId. */
export const artifactIdSchema = z.string().min(1) as unknown as z.ZodType<import('./artifacts.ts').ArtifactId>

export const artifactKindSchema = z.enum(['html', 'slides', 'doc', 'sheet', 'chart'])

export const artifactSourceSchema = z.enum([
  'tool-html',
  'tool-slides',
  'tool-doc',
  'tool-sheet',
  'tool-mermaid',
  'tool-svg',
])

export const artifactMediaTypeSchema = z.enum([
  'text/html',
  'text/markdown',
  'image/svg+xml',
  'image/png',
  'image/jpeg',
  'application/pdf',
])

/** One artifact row carried by every artifact.* response. */
export const artifactViewSchema = z.object({
  artifactId: artifactIdSchema,
  kind: artifactKindSchema,
  source: artifactSourceSchema,
  mediaType: artifactMediaTypeSchema,
  bytes: z.number().int().nonnegative(),
  title: z.string().optional(),
  workspaceId: workspaceIdSchema.optional(),
  sessionId: sessionIdSchema.optional(),
  createdAt: z.string(),
  name: z.string().optional(),
}) satisfies z.ZodType<Wire<ArtifactView>>

/** artifact.list request payload (workspaceId / sessionId both optional). */
export const artifactListRequestSchema = z.object({
  workspaceId: workspaceIdSchema.optional(),
  sessionId: sessionIdSchema.optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'artifact.list'>>>

/** artifact.list response value. */
export const artifactListValueSchema = z.object({
  items: z.array(artifactViewSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'artifact.list'>>>

/** artifact.read request payload. */
export const artifactReadRequestSchema = z.object({
  artifactId: artifactIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'artifact.read'>>>

/** artifact.read response value. */
export const artifactReadValueSchema = z.object({
  view: artifactViewSchema,
  bytesBase64: z.string(),
}) satisfies z.ZodType<Wire<ResponseValue<'artifact.read'>>>

/** artifact.remove request payload. */
export const artifactRemoveRequestSchema = z.object({
  artifactId: artifactIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'artifact.remove'>>>

/** artifact.remove response value. */
export const artifactRemoveValueSchema = z.object({
  removed: z.literal(true),
}) satisfies z.ZodType<Wire<ResponseValue<'artifact.remove'>>>
