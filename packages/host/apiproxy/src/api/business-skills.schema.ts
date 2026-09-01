/** Zod wire schemas for authenticated business Skill administration. */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'

const jsonSchema = z.record(z.string(), z.unknown())
const operation = z.object({
  id: z.string(),
  method: z.literal('GET'),
  path: z.string(),
  input: jsonSchema,
  output: jsonSchema,
  permission: z.string(),
  connection: z.string(),
  credentialRef: z.string().optional(),
  risk: z.literal('R1'),
  maxResponseBytes: z.number().int().positive().optional(),
})
const manifest = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string(),
  connectionIds: z.array(z.string()),
  credentialRefs: z.array(z.string()),
  operations: z.array(operation),
})
const version = z.object({ revision: z.number().int().positive(), manifest, active: z.boolean() })

/** Empty list request payload. */
export const businessSkillsListRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'account.businessSkills.list'>>>
/** Version list response payload. */
export const businessSkillsListValueSchema = z.object({ items: z.array(version) }) satisfies z.ZodType<Wire<ResponseValue<'account.businessSkills.list'>>>
/** Manifest validation request payload. */
export const businessSkillsValidateRequestSchema = z.object({ manifestText: z.string().min(1) }) satisfies z.ZodType<Wire<RequestPayload<'account.businessSkills.validate'>>>
/** Manifest validation response payload. */
export const businessSkillsValidateValueSchema = z.object({ valid: z.boolean(), issues: z.array(z.string()) }) satisfies z.ZodType<Wire<ResponseValue<'account.businessSkills.validate'>>>
/** Version publication request payload. */
export const businessSkillsPublishRequestSchema = z.object({ manifestText: z.string().min(1), expectedRevision: z.number().int().nonnegative().optional() }) satisfies z.ZodType<Wire<RequestPayload<'account.businessSkills.publish'>>>
/** Published revision response payload. */
export const businessSkillsPublishValueSchema = version satisfies z.ZodType<Wire<ResponseValue<'account.businessSkills.publish'>>>
/** Disable request payload. */
export const businessSkillsDisableRequestSchema = z.object({ skill: z.string().min(1), expectedRevision: z.number().int().positive().optional() }) satisfies z.ZodType<Wire<RequestPayload<'account.businessSkills.disable'>>>
/** Disable response payload. */
export const businessSkillsDisableValueSchema = z.object({ disabled: z.literal(true) }) satisfies z.ZodType<Wire<ResponseValue<'account.businessSkills.disable'>>>
/** Rollback request payload. */
export const businessSkillsRollbackRequestSchema = z.object({ skill: z.string().min(1), revision: z.number().int().positive(), expectedRevision: z.number().int().positive().optional() }) satisfies z.ZodType<Wire<RequestPayload<'account.businessSkills.rollback'>>>
/** Activated revision response payload. */
export const businessSkillsRollbackValueSchema = version satisfies z.ZodType<Wire<ResponseValue<'account.businessSkills.rollback'>>>
