/**
 * Cloud-only account route ownership and service adapter.
 *
 * This module deliberately has no dependency on a Host or device runtime. The
 * old apiproxy package can adapt these narrow requests to its wire types while
 * a device host can omit this package altogether.
 */
import type { Context } from '@deepseek-ai/cordis'
import { IdentityError } from '@deepseek-ai/dsh-account-identity'
import { EmailVerificationError } from '@deepseek-ai/dsh-account-email-verification'
import { WalletError } from '@deepseek-ai/dsh-account-wallet'
import { ModelKeyError } from '@deepseek-ai/dsh-account-model-keys'
import type {} from '@deepseek-ai/dsh-web'

// The cloud assembly owns these seams. Re-exporting their public contracts
// keeps the gateway's dependency edge pointed at this provider package.
export { IdentityError } from '@deepseek-ai/dsh-account-identity'
export type { SignedIn, AuthenticatedView } from '@deepseek-ai/dsh-account-identity'
export { EmailVerificationError } from '@deepseek-ai/dsh-account-email-verification'
export { WalletError } from '@deepseek-ai/dsh-account-wallet'
export type { WalletView, LedgerEntry } from '@deepseek-ai/dsh-account-wallet'
export { ModelKeyError, CUSTOM_MODEL_PROVIDER_ROUTE } from '@deepseek-ai/dsh-account-model-keys'
export type { ProvisionedKey, CustomModelId, CustomModelView, CustomModelView as StoredCustomModelView } from '@deepseek-ai/dsh-account-model-keys'
export { PluginFactoryError, mountAccountPlugins } from '@deepseek-ai/dsh-account-plugin-factory'
export type { AccountPluginView } from '@deepseek-ai/dsh-account-plugin-factory'

/** Narrow request used by the provider adapter; transports add their own envelope. */
export interface AccountProviderRequest {
  rpcId: string
  payload: Record<string, unknown>
  principal?: AccountPrincipal | { kind: 'local' }
  signal?: AbortSignal
}

/** Narrow response returned by the provider adapter. */
export interface AccountProviderResponse<T = unknown> {
  rpcId: string
  result: { ok: true; value: T } | { ok: false; error: { code: string; message: string; details: Record<string, unknown> } }
}

/** Every cloud-owned RPC route. Keep this list disjoint from device/core routes. */
export const ACCOUNT_RPC_METHODS = [
  'account.signup', 'account.emailCode', 'account.invites.create', 'account.invites.list',
  'account.invites.rotate', 'account.signin', 'account.signout', 'account.state',
  'account.wallet.get', 'account.wallet.credit', 'account.wallet.debit',
  'account.wallet.setQuota', 'account.wallet.refreshDaily', 'account.wallet.grantWelcomeBonus',
  'account.wallet.listLedger', 'account.modelKeys.provision', 'account.modelKeys.list',
  'account.modelKeys.revoke', 'account.customModels.create', 'account.customModels.list',
  'account.customModels.remove', 'account.plugins.list', 'account.plugins.install',
  'account.plugins.uninstall',
  'account.web.search',
] as const

/** A cloud route name. */
export type AccountRpcMethod = typeof ACCOUNT_RPC_METHODS[number]

/** Set form used by the carrier and route-partition gates. */
export const ACCOUNT_RPC_METHOD_SET: ReadonlySet<string> = new Set(ACCOUNT_RPC_METHODS)

/** Return whether a method belongs exclusively to the account provider. */
export function isAccountRpcMethod(method: string): method is AccountRpcMethod {
  return ACCOUNT_RPC_METHOD_SET.has(method)
}

/**
 * Validate the cloud/device route partition at assembly time. `allMethods` is
 * the authoritative RpcMethodMap key set and `coreMethods` is supplied by the
 * device-safe core; neither set is guessed or silently filled in.
 * @param coreMethods - methods owned by the device-safe core.
 * @param allMethods - complete wire method registry.
 * @returns nothing when the partition is exact.
 * @throws Error when account routes overlap core routes or leave a method uncovered.
 */
export function assertRoutePartition(
  coreMethods: Iterable<string>, allMethods: Iterable<string>,
): void {
  const core = new Set(coreMethods)
  const all = new Set(allMethods)
  for (const method of ACCOUNT_RPC_METHODS) {
    if (core.has(method)) throw new Error(`RPC route overlaps account provider: ${method}`)
    if (!all.has(method)) throw new Error(`account provider route is absent from RpcMethodMap: ${method}`)
  }
  for (const method of all) {
    if (!core.has(method) && !ACCOUNT_RPC_METHOD_SET.has(method)) {
      throw new Error(`RPC route is not owned by core or account provider: ${method}`)
    }
  }
}

/** Account identity attached by a trusted cloud carrier. */
export type AccountPrincipal = { kind: 'account'; userId: string }

/** Return the owner or fail closed for account-owned mutations. */
export function accountOwner(principal: AccountPrincipal | { kind: 'local' } | undefined): string | undefined {
  return principal?.kind === 'account' ? principal.userId : undefined
}

/** Stable account-authentication refusal used by all account-owned routes. */
export const ACCOUNT_AUTH_ERROR = {
  code: 'unauthenticated', message: 'account authentication required', details: {},
} as const

/** Ensure an account route cannot accidentally use a local principal. */
export function requireAccountOwner(principal: AccountPrincipal | { kind: 'local' } | undefined): string {
  const owner = accountOwner(principal)
  if (owner === undefined) throw new Error(ACCOUNT_AUTH_ERROR.message)
  return owner
}

/** Map account-seam failures to the cloud wire error code. */
export function accountErrorCode(error: unknown): string {
  if (error instanceof IdentityError) {
    switch (error.code) {
      case 'EMAIL_TAKEN': return 'email-taken'
      case 'UNAUTHENTICATED': case 'SESSION_EXPIRED': return 'unauthenticated'
      case 'INVITATION_REQUIRED': case 'INVITATION_INVALID': return 'invitation-invalid'
      case 'INVITATION_LIMIT': return 'invitation-limit'
      case 'USER_LIMIT': return 'user-limit'
      case 'BAD_REQUEST': return 'bad-request'
      case 'IDENTITY_UNAVAILABLE': return 'internal'
    }
  }
  if (error instanceof EmailVerificationError) {
    switch (error.code) {
      case 'RESEND_COOLDOWN': return 'email-code-resend-cooldown'
      case 'RATE_LIMIT_EXCEEDED': return 'email-code-rate-limit'
      case 'WRONG_CODE': return 'email-code-wrong'
      case 'CODE_EXPIRED': return 'email-code-expired'
      case 'CODE_LOCKED': return 'email-code-locked'
      default: return 'bad-request'
    }
  }
  if (error instanceof WalletError) return error.code === 'INSUFFICIENT_BALANCE' ? 'insufficient-balance' : 'bad-request'
  if (error instanceof ModelKeyError) return error.code === 'KEY_NOT_FOUND' ? 'model-key-not-found' : 'bad-request'
  return 'internal'
}

/** Map a configured account owner to its private workspace root. */
export function accountWorkspacePath(root: string, userId: string): string {
  // Callers still canonicalize and containment-check the resulting path before
  // filesystem access; this function only defines the deterministic partition.
  return `${root.replace(/[\\/]+$/, '')}/${encodeURIComponent(userId)}`
}

/** Minimal service lookup used by cloud assemblies to prove account mounting. */
export function accountServicesMounted(ctx: Context): boolean {
  return ctx.get('identity') !== undefined
}

/**
 * Build the cloud account dispatcher over the account service seams. The
 * dispatcher is intentionally transport-neutral; apiproxy adapts its
 * `RpcRequest`/`RpcResponse` envelope at one call site.
 * @param ctx - Cloud Cordis context carrying account services.
 * @returns A method dispatcher for all account-owned RPC routes.
 */
export function createAccountApiProvider(ctx: Context): {
  dispatch(request: AccountProviderRequest, method: AccountRpcMethod): Promise<AccountProviderResponse>
} {
  const success = (request: AccountProviderRequest, value: unknown): AccountProviderResponse => ({
    rpcId: request.rpcId, result: { ok: true, value },
  })
  const failure = (request: AccountProviderRequest, error: unknown): AccountProviderResponse => ({
    rpcId: request.rpcId,
    result: {
      ok: false,
      error: {
        code: accountErrorCode(error),
        message: error instanceof Error ? error.message : String(error),
        details: {},
      },
    },
  })
  const owner = (request: AccountProviderRequest): string => {
    const value = accountOwner(request.principal)
    if (value === undefined) throw new Error(ACCOUNT_AUTH_ERROR.message)
    return value
  }
  return {
    async dispatch(request, method) {
      try {
        const payload = request.payload
        const identity = ctx.get('identity')
        switch (method) {
          case 'account.signup': {
            if (identity === undefined) throw new Error('identity service is not mounted')
            const signed = await identity.signup({
              email: String(payload.email),
              password: String(payload.password),
              invitationCode: String(payload.invitationCode),
              ...(typeof payload.displayName === 'string' ? { displayName: payload.displayName } : {}),
            })
            const wallet = ctx.get('wallet')
            if (wallet !== undefined) await wallet.grantWelcomeBonus({ userId: signed.userId })
            return success(request, signed)
          }
          case 'account.emailCode': {
            const verification = ctx.get('emailVerification')
            if (verification === undefined) throw new Error('email-verification service is not mounted')
            if (identity === undefined) throw new Error('identity service is not mounted')
            const invitation = await identity.inspectInvitation({ code: String(payload.invitationCode) })
            return success(request, await verification.requestCode({
              email: String(payload.email),
              purpose: 'signup',
              invitationId: invitation.invitationId,
            }))
          }
          case 'account.invites.create':
            if (identity === undefined) throw new Error('identity service is not mounted')
            return success(request, await identity.createInvitation({ ownerId: owner(request) as never }))
          case 'account.invites.list':
            if (identity === undefined) throw new Error('identity service is not mounted')
            return success(request, { items: await identity.listInvitations({ ownerId: owner(request) as never }) })
          case 'account.invites.rotate':
            if (identity === undefined) throw new Error('identity service is not mounted')
            return success(request, await identity.rotateInvitation({
              ownerId: owner(request) as never,
              invitationId: String(payload.invitationId) as never,
            }))
          case 'account.signin':
            if (identity === undefined) throw new Error('identity service is not mounted')
            return success(request, await identity.signin({ email: String(payload.email), password: String(payload.password) }))
          case 'account.signout':
            if (identity === undefined) throw new Error('identity service is not mounted')
            await identity.signout({ sessionToken: String(payload.sessionToken) as never }); return success(request, { revoked: true })
          case 'account.state':
            return success(
              request,
              identity === undefined
                ? null
                : await identity.validate({ sessionToken: String(payload.sessionToken) as never }),
            )
          case 'account.wallet.get': {
            const wallet = ctx.get('wallet'); if (wallet === undefined) throw new Error('wallet service is not mounted')
            const userId = (accountOwner(request.principal) ?? String(payload.userId)) as never
            return success(request, await wallet.get({ userId }))
          }
          case 'account.wallet.listLedger': {
            const wallet = ctx.get('wallet'); if (wallet === undefined) throw new Error('wallet service is not mounted')
            const userId = (accountOwner(request.principal) ?? String(payload.userId)) as never
            const items = await wallet.listLedger({
              userId,
              ...(payload.limit === undefined ? {} : { limit: Number(payload.limit) }),
            })
            return success(request, { items })
          }
          case 'account.wallet.credit': case 'account.wallet.debit': case 'account.wallet.setQuota': case 'account.wallet.refreshDaily': case 'account.wallet.grantWelcomeBonus': {
            const wallet = ctx.get('wallet'); if (wallet === undefined) throw new Error('wallet service is not mounted')
            if (request.principal?.kind === 'account') throw new Error('wallet management requires a local principal')
            const userId = String(payload.userId) as never
            if (method === 'account.wallet.grantWelcomeBonus') return success(request, await wallet.grantWelcomeBonus({ userId }))
            if (method === 'account.wallet.refreshDaily') return success(request, await wallet.refreshDaily({ userId, idempotencyKey: String(payload.idempotencyKey) }))
            if (method === 'account.wallet.setQuota') return success(request, await wallet.setQuota({ userId, balanceMicros: Number(payload.balanceMicros), reason: String(payload.reason) as never }))
            const input = {
              userId,
              amountMicros: Number(payload.amountMicros),
              reason: String(payload.reason) as never,
              ...(payload.idempotencyKey === undefined
                ? {}
                : { idempotencyKey: String(payload.idempotencyKey) }),
            }
            return success(request, method === 'account.wallet.credit' ? await wallet.credit(input) : await wallet.debit(input))
          }
          case 'account.modelKeys.provision': case 'account.modelKeys.list': case 'account.modelKeys.revoke': {
            const keys = ctx.get('userModelKeys'); if (keys === undefined) throw new Error('user-model-keys service is not mounted')
            if (method === 'account.modelKeys.list') return success(request, { items: await keys.list({ userId: (accountOwner(request.principal) ?? String(payload.userId)) as never }) })
            if (request.principal?.kind === 'account') throw new Error('model-key management requires a local principal')
            if (method === 'account.modelKeys.provision') return success(request, await keys.provision({ userId: String(payload.userId) as never, ...(payload.label === undefined ? {} : { label: String(payload.label) }) }))
            return success(request, await keys.revoke({ keyId: String(payload.keyId) as never }))
          }
          case 'account.customModels.create': case 'account.customModels.list': case 'account.customModels.remove': {
            const keys = ctx.get('userModelKeys'); if (keys === undefined) throw new Error('user-model-keys service is not mounted')
            const userId = owner(request) as never
            if (method === 'account.customModels.list') return success(request, { items: (await keys.listCustom({ userId })).map(({ userId: _userId, ...item }) => item) })
            if (method === 'account.customModels.create') {
              const { label, api, baseURL, upstreamModel, apiKey } = payload
              const { userId: _userId, ...item } = await keys.createCustom({
                userId,
                label: String(label),
                api: String(api) as never,
                baseURL: String(baseURL),
                upstreamModel: String(upstreamModel),
                apiKey: String(apiKey),
              })
              return success(request, item)
            }
            return success(request, await keys.removeCustom({ userId, customModelId: String(payload.customModelId) as never }))
          }
          case 'account.plugins.list': case 'account.plugins.install': case 'account.plugins.uninstall': {
            const plugins = ctx.get('accountPluginFactory'); if (plugins === undefined) throw new Error('account plugin factory is not mounted')
            const userId = owner(request)
            if (method === 'account.plugins.list') return success(request, { items: await plugins.list({ userId }) })
            const pluginId = String(payload.pluginId)
            return success(request, await plugins[method === 'account.plugins.install' ? 'install' : 'uninstall']({ userId, pluginId }))
          }
          case 'account.web.search': {
            owner(request)
            const web = ctx.get('web'); if (web === undefined) throw new Error('web service is not mounted')
            const result = await web.search({
              query: String(payload.query),
              ...(payload.maxResults === undefined ? {} : { maxResults: Number(payload.maxResults) }),
            }, request.signal)
            return success(request, result)
          }
        }
      } catch (error) {
        return failure(request, error)
      }
    },
  }
}
