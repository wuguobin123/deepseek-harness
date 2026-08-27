/**
 * account domain zod schemas (names derived from map keys).
 *
 * The session token and user id ride the wire as opaque base64url strings;
 * the schema accepts any non-empty string — the host implementation re-brands
 * to the identity-package brand at the call site. Length is bounded only by
 * the brand's minimum (1 char) so the schema does not duplicate the
 * identity-package generator.
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import type { AuthenticatedView, SignedIn } from './account.ts'

/** Wire-side opaque id brand cast (UserId and SessionToken both share this shape). */
const opaqueIdSchema = z.string().min(1)

/** One signed-in session view carried by every account.signup / account.signin response. */
export const signedInSchema = z.object({
  userId: opaqueIdSchema,
  displayName: z.string().nullable(),
  sessionToken: opaqueIdSchema,
  expiresAt: z.number().int().positive(),
}) satisfies z.ZodType<Wire<SignedIn>>

/** Cold-start probe view of a live session. */
export const authenticatedViewSchema = z.object({
  userId: opaqueIdSchema,
  displayName: z.string().nullable(),
  expiresAt: z.number().int().positive(),
}) satisfies z.ZodType<Wire<AuthenticatedView>>

/** account.signup request payload. */
export const accountSignupRequestSchema = z.object({
  email: z.string().min(1).max(254),
  password: z.string().min(1).max(1024),
  displayName: z.string().max(254).optional(),
  /**
   * Six-digit verification code produced by `account.emailCode`. Required
   * when the host's email-verification seam is enabled; the host returns
   * `verification-code-required` when omitted.
   */
  verificationCode: z.string().regex(/^\d{6}$/).optional(),
  invitationCode: z.string().min(1).max(256),
}) satisfies z.ZodType<Wire<RequestPayload<'account.signup'>>>

/** account.emailCode request payload. */
export const accountEmailCodeRequestSchema = z.object({
  email: z.string().min(1).max(254),
  invitationCode: z.string().min(1).max(256),
}) satisfies z.ZodType<Wire<RequestPayload<'account.emailCode'>>>

/** account.emailCode response value. */
export const accountEmailCodeValueSchema = z.object({
  expiresInSeconds: z.number().int().positive(),
  retryAfterSeconds: z.number().int().nonnegative(),
}) satisfies z.ZodType<Wire<ResponseValue<'account.emailCode'>>>

const invitationViewSchema = z.object({
  invitationId: opaqueIdSchema,
  codeMask: z.string().min(1),
  code: z.string().min(1).nullable(),
  createdAt: z.number().int().positive(),
  expiresAt: z.number().int().positive(),
  consumedAt: z.number().int().positive().nullable(),
  redeemedBy: opaqueIdSchema.nullable(),
})
/** Empty authenticated request schema for creating an owned invitation. */
export const accountInvitesCreateRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'account.invites.create'>>>
/** Response schema for creating an invitation; `code` contains the new plaintext value. */
export const accountInvitesCreateValueSchema = invitationViewSchema.extend({ code: z.string().min(1) }) satisfies z.ZodType<Wire<ResponseValue<'account.invites.create'>>>
/** Empty authenticated request schema for listing owned invitations. */
export const accountInvitesListRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'account.invites.list'>>>
/** Owned invitation list; active decryptable rows include `code`. */
export const accountInvitesListValueSchema = z.object({ items: z.array(invitationViewSchema) }) satisfies z.ZodType<Wire<ResponseValue<'account.invites.list'>>>
/** Request schema for explicitly regenerating one owned invitation. */
export const accountInvitesRotateRequestSchema = z.object({ invitationId: opaqueIdSchema }) satisfies z.ZodType<Wire<RequestPayload<'account.invites.rotate'>>>
/** Response schema containing the replacement plaintext code. */
export const accountInvitesRotateValueSchema = invitationViewSchema.extend({ code: z.string().min(1) }) satisfies z.ZodType<Wire<ResponseValue<'account.invites.rotate'>>>

/** account.signup response value. */
export const accountSignupValueSchema = signedInSchema satisfies z.ZodType<Wire<ResponseValue<'account.signup'>>>

/** account.signin request payload. */
export const accountSigninRequestSchema = z.object({
  email: z.string().min(1).max(254),
  password: z.string().min(1).max(1024),
}) satisfies z.ZodType<Wire<RequestPayload<'account.signin'>>>

/** account.signin response value. */
export const accountSigninValueSchema = signedInSchema satisfies z.ZodType<Wire<ResponseValue<'account.signin'>>>

/** account.signout request payload. */
export const accountSignoutRequestSchema = z.object({
  sessionToken: opaqueIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'account.signout'>>>

/** account.signout response value. */
export const accountSignoutValueSchema = z.object({
  revoked: z.literal(true),
}) satisfies z.ZodType<Wire<ResponseValue<'account.signout'>>>

/** account.state request payload. */
export const accountStateRequestSchema = z.object({
  sessionToken: opaqueIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'account.state'>>>

/** account.state response value: the live account view, or null for unknown / expired tokens. */
export const accountStateValueSchema: z.ZodType<Wire<ResponseValue<'account.state'>>> = authenticatedViewSchema.nullable()
