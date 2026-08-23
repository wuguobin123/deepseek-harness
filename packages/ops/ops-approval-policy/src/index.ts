/**
 * `@deepseek-ai/dsh-ops-approval-policy` — Phase 1 skeleton.
 *
 * Extends `@deepseek-ai/dsh-interaction-user-approval` with the scenario-side
 * policy fields the ops product needs on top of the generic approval chain:
 *
 * - `risk` (R1 / R2 / R3) — capability-manifest-declared risk tier the granted
 *   approval is bound to.
 * - `executionVersion` (preset sha) — pins a granted approval to the preset
 *   revision it was authored against, so a preset bump invalidates old grants.
 * - `validForSeconds` — TTL for the grant; `0` means the grant is per-call
 *   only and must not be reused.
 * - `argumentsHash` — canonical-JSON hash of the request arguments, used to
 *   detect argument drift between grant and invocation.
 *
 * Today the package ships a skeleton: `ctx.userApproval` is not changed and
 * the policy resolver lands with the first scenario that needs it. The
 * skeleton reserves the surface so other ops packages can compile against
 * these field names while the resolver is still being designed.
 *
 * @module @deepseek-ai/dsh-ops-approval-policy
 */

import type { Context } from '@deepseek-ai/cordis'

/** Cordis plugin name used by `cordis.yml`. */
export const name = 'ops-approval-policy'
/**
 * Skeleton has no service dependencies; the resolver lands with the first
 * scenario that needs it. The parent `ApprovalService` is auto-injected by
 * name (`approvalService`) when the resolver mounts.
 */
export const inject: string[] = []
/** No configurable surface yet; config lands with the first scenario that needs the resolver. */
export interface Config {}

/**
 * Phase 1 entry point. The plugin is intentionally a no-op until a scenario
 * declares the resolver that uses the four policy fields.
 * @param ctx - Cordis context (currently unused; reserved for the future `opsApprovalPolicy` service).
 */
export const apply = (_ctx: Context): void => {}
