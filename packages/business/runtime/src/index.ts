/** Stable model Tool and dynamic Skill provider for account business integrations. */

import type { Context } from '@deepseek-ai/cordis'
import { BusinessSkillError, type BusinessSkillService, type SkillVersion } from '@deepseek-ai/dsh-business-skill'
import type {
  BusinessConnectorRegistry, BusinessPrincipal, CredentialResolver,
} from '@deepseek-ai/dsh-business-connector'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { SkillCandidate, SkillDefinition } from '@deepseek-ai/dsh-skill'
import { BUNDLED_SKILL_RANK } from '@deepseek-ai/dsh-skill'
import { defineTool, validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-session'

export const name = 'business-skill-runtime'
export const inject = ['businessSkill', 'businessConnectors', 'credentials', 'skills', 'tools']

/** Trusted execution context created from the calling Session. */
export interface BusinessExecutionContext {
  readonly principal: BusinessPrincipal
  readonly traceId?: string
  readonly actor?: string
  readonly signal?: AbortSignal
}

/** Secret-free audit record for one operation. */
export interface BusinessSkillAudit {
  readonly actor?: string
  readonly skill: string
  readonly revision: number
  readonly operation: string
  readonly status: 'ok' | 'error'
  readonly traceId?: string
}

/** Runtime dependencies, injectable for deterministic tests. */
export interface BusinessSkillRuntimeOptions {
  readonly skills: BusinessSkillService
  readonly connectors: BusinessConnectorRegistry
  readonly credentials?: CredentialResolver
  readonly audit?: (event: BusinessSkillAudit) => void
}

const RESERVED = new Set([
  'userId', 'tenantId', 'principal', 'token', 'accessToken', 'authorization', 'roles', 'scopes',
])

function rejectReservedInput(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(rejectReservedInput)
    return
  }
  if (value === null || typeof value !== 'object') return
  for (const [key, item] of Object.entries(value)) {
    if (RESERVED.has(key)) throw new BusinessSkillError('RESERVED_FIELD', `reserved input field ${key}`)
    rejectReservedInput(item)
  }
}

function validateOutput(value: unknown, schema: Record<string, unknown>, maxBytes = 1024 * 1024): void {
  const encoded = JSON.stringify(value)
  if (new TextEncoder().encode(encoded).byteLength > maxBytes) {
    throw new BusinessSkillError('OUTPUT_TOO_LARGE', 'business operation response exceeds byte limit')
  }
  const violations = validateJsonSchemaValue(schema, value, 'result')
  if (violations.length > 0) throw new BusinessSkillError('OUTPUT_INVALID', violations.join('; '))
}

/** Runtime dispatcher; account identity never appears in its model arguments. */
export class BusinessSkillRuntime {
  constructor(private readonly options: BusinessSkillRuntimeOptions) {}

  /** Resolve the active immutable revision and invoke one approved operation.
   * @param context - Trusted identity and execution metadata from the Session.
   * @param args - Model-controlled Skill, operation, and business-only input.
   * @returns Validated business API response.
   */
  async call(
    context: BusinessExecutionContext,
    args: { skill: string; operation: string; input: unknown },
  ): Promise<unknown> {
    rejectReservedInput(args.input)
    const version = await this.options.skills.resolve(context.principal.userId, args.skill)
    if (version === null || !version.active) {
      throw new BusinessSkillError('SKILL_INACTIVE', 'business Skill is not active')
    }
    const operation = version.manifest.operations.find(item => item.id === args.operation)
    if (operation === undefined) {
      throw new BusinessSkillError('OPERATION_NOT_FOUND', 'operation is not configured')
    }
    const inputViolations = validateJsonSchemaValue(operation.input, args.input, 'input')
    if (inputViolations.length > 0) {
      throw new BusinessSkillError('INPUT_INVALID', inputViolations.join('; '))
    }
    const connector = this.options.connectors.get(operation.connection)
    if (connector === undefined) {
      throw new BusinessSkillError('CONNECTOR_UNAVAILABLE', 'approved connector is unavailable')
    }
    const selectedRef = operation.credentialRef
    if (
      selectedRef !== undefined
      && (connector.allowedCredentialRefs === undefined || !connector.allowedCredentialRefs.has(selectedRef))
    ) {
      throw new BusinessSkillError('CREDENTIAL_REF_DENIED', 'credential reference is not approved for this connector')
    }
    try {
      const credential = selectedRef === undefined || this.options.credentials === undefined
        ? undefined
        : await this.options.credentials.resolve(selectedRef)
      if (selectedRef !== undefined && credential === undefined) {
        throw new BusinessSkillError('CREDENTIAL_UNAVAILABLE', 'configured credential is unavailable')
      }
      const result = await connector.execute({
        operation,
        input: args.input,
        principal: context.principal,
        ...(context.traceId === undefined ? {} : { traceId: context.traceId }),
        ...(credential === undefined ? {} : { credential }),
        ...(context.signal === undefined ? {} : { signal: context.signal }),
      })
      validateOutput(result, operation.output, operation.maxResponseBytes)
      this.audit(context, version, operation.id, 'ok')
      return result
    } catch (error) {
      this.audit(context, version, operation.id, 'error')
      throw error
    }
  }

  private audit(
    context: BusinessExecutionContext,
    version: SkillVersion,
    operation: string,
    status: BusinessSkillAudit['status'],
  ): void {
    this.options.audit?.({
      ...(context.actor === undefined ? {} : { actor: context.actor }),
      skill: version.manifest.name,
      revision: version.revision,
      operation,
      status,
      ...(context.traceId === undefined ? {} : { traceId: context.traceId }),
    })
  }
}

function candidate(version: SkillVersion): SkillCandidate {
  return {
    name: version.manifest.name,
    description: version.manifest.description,
    whenToUse: `Use for the ${version.manifest.name} account business operations listed in this Skill.`,
    invocation: { modelInvocable: true, userInvocable: true },
    source: 'business-account',
    provider: 'business-account',
    rank: BUNDLED_SKILL_RANK,
    locator: { revision: version.revision },
  }
}

function definition(version: SkillVersion): SkillDefinition {
  const summary = candidate(version)
  const operations = version.manifest.operations.map(operation => [
    '- `' + operation.id + '`: permission `' + operation.permission + '`, read-only risk `' + operation.risk + '`.',
    '  Input JSON Schema: `' + JSON.stringify(operation.input) + '`',
  ].join('\n'))
  return {
    ...summary,
    content: [
      version.manifest.description,
      '',
      'Call `business_skill_call` with only `skill`, `operation`, and business `input`.',
      '`userId`, `tenantId`, tokens, roles, and permissions are supplied by the platform and must never be added to tool input.',
      'The business API receives the authenticated user identity and performs the operation permission check.',
      '',
      'Available operations:',
      ...operations,
    ].join('\n'),
  }
}

/** Mount the dynamic Skill provider and the stable dispatcher Tool. */
export function apply(ctx: Context): void {
  const credentials: CredentialResolver | undefined = ctx.get('credentials') === undefined
    ? undefined
    : {
      resolve: async ref => (await ctx.credentials.resolve(credentialRef(ref)))?.value,
    }
  const runtime = new BusinessSkillRuntime({
    skills: ctx.businessSkill,
    connectors: ctx.businessConnectors,
    ...(credentials === undefined ? {} : { credentials }),
    audit: (event) => { ctx.logger.info('business Skill call', event) },
  })
  ctx.skills.registerProvider(() => ({
    name: 'business-account',
    list: async options => options.ownerId === undefined
      ? []
      : (await ctx.businessSkill.list(options.ownerId)).filter(version => version.active).map(candidate),
    get: async (entry, options) => {
      if (options.ownerId === undefined) return undefined
      const locator = entry.locator as { revision?: unknown }
      if (typeof locator.revision !== 'number') return undefined
      const version = await ctx.businessSkill.get(options.ownerId, entry.name, locator.revision)
      return version === null || !version.active ? undefined : definition(version)
    },
  }))
  ctx.tools.register(defineTool({
    name: 'business_skill_call',
    description: [
      'Call one read-only operation from an installed account business Skill.',
      'Identity and permissions are supplied by Xiaowei, never in arguments.',
    ].join(' '),
    parameters: {
      skill: { type: 'string', required: true, description: 'Business Skill name.' },
      operation: { type: 'string', required: true, description: 'Operation id from the loaded Skill.' },
      input: {
        type: 'object',
        additionalProperties: true,
        required: true,
        description: 'Business parameters only; never identity, tenant, token, role, or permission fields.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          skill: { type: 'string', required: true },
          operation: { type: 'string', required: true },
          result: { type: 'object', additionalProperties: true, required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value.result) }],
    },
    async execute(args, exec) {
      if (exec.agent?.session.header.origin === 'subagent') {
        throw new BusinessSkillError('SUBAGENT_DENIED', 'subagents cannot call account business Skills')
      }
      const ownerId = exec.agent?.session.header.ownerId
      if (ownerId === undefined) throw new BusinessSkillError('OWNER_REQUIRED', 'authenticated account owner is required')
      const result = await runtime.call({
        principal: { userId: ownerId },
        actor: ownerId,
        traceId: String(exec.callId),
        signal: exec.signal,
      }, args)
      if (result === null || typeof result !== 'object' || Array.isArray(result)) {
        throw new BusinessSkillError('OUTPUT_INVALID', 'business Skill Tool output must be an object')
      }
      return { skill: args.skill, operation: args.operation, result: result as Record<string, JsonValue> }
    },
    presentCall: args => ({
      card: 'generic', title: `${args.skill}: ${args.operation}`, kind: 'read', rawInput: JSON.stringify(args.input),
    }),
  }))
}
