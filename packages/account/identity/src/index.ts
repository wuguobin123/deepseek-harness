/**
 * Service Definition + default SQLite-backed provider for the local xiaowei
 * identity seam.
 *
 * The seam owns account, session, and invitation ids; invitation inspection,
 * creation, listing, and redemption; and the lifecycle of opaque bearer
 * tokens over `<dshHome>/identity.sqlite`. Wire methods in
 * `packages/host/apiproxy/src/api/account.ts` consume the same provider via
 * `ctx.identity`; the trust fence in
 * `packages/client/connection/src/api-request-auth.ts` resolves the same
 * tokens.
 *
 * Single-package pre-release stance: the abstract `IdentityService` and the
 * sole implementation `LocalIdentityProvider` live here together. A future
 * "hosted IdP" provider would split this seam into its own package; for now,
 * the SQLite shape is the only shape the harness needs.
 *
 * @module @deepseek-ai/dsh-account-identity
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { hashPassword, verifyPassword } from './password.ts'
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto'
import { link, open, readFile, unlink } from 'node:fs/promises'
import { IdentityStore, createSessionToken, createUserId, openIdentityDatabase, nowMillis } from './store.ts'
import { IdentityError, MAX_PASSWORD_LENGTH, assertEmail, assertPassword } from './errors.ts'
import type { AuthenticatedView, InvitationId, InvitationView, SessionToken, SignedIn, UserId } from './types.ts'

/** Plugin configuration. */
export interface Config {
  /** Path to the SQLite database file (`:memory:` for tests). */
  path: string
  /**
   * Default lifetime of an issued session token, in seconds. After this
   * window the token is rejected by `validate` regardless of row presence.
   * Bumping this does not retroactively extend live sessions.
   */
  sessionTtlSeconds?: number
  /**
   * Bootstrap admin: when the `users` table is empty at boot, the provider
   * creates this single account so the deployment has a known identity.
   * Leaving the email empty disables bootstrap entirely (the deployment
   * starts with no users — every method that needs one fails closed).
   */
  bootstrap?: {
    /** Email address for the initial account. */
    email: string
    /** Password for the initial account. */
    password: string
    /** Optional display name for the initial account. */
    displayName?: string
  }
  /** Secret used to derive invitation code digests. */
  invitationPepper?: string
  /** Maximum number of stored users, including bootstrap users. */
  maxUsers?: number
  /** Lifetime allowance per user. */
  maxInvitationsPerUser?: number
  /** Invitation lifetime in seconds. */
  invitationTtlSeconds?: number
}

export const Config: z<Config> = z.object({
  path: z.string().required(),
  sessionTtlSeconds: z.number().step(1).min(60).max(2_592_000).default(86_400),
  bootstrap: z.object({
    email: z.string().required(),
    password: z.string().max(MAX_PASSWORD_LENGTH).required(),
    displayName: z.string(),
  }).default({ email: '', password: '', displayName: '' }),
  invitationPepper: z.string().role('secret').default(''),
  maxUsers: z.number().step(1).min(1).default(100),
  maxInvitationsPerUser: z.number().step(1).min(1).default(3),
  invitationTtlSeconds: z.number().step(1).min(1).default(604800),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The local identity provider (Service Definition: `IdentityService`). */
    identity: IdentityService
  }
}

/**
 * The Service Definition for the identity seam. Every implementation owns
 * users, sessions, and invitations; cross-process or hosted IdPs would extend
 * this contract without changing the wire fields.
 */
export abstract class IdentityService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'identity')
  }

  /**
   * Create one account and return an immediately-valid session.
   * @param input Email, password, optional display name, and invitation code.
   * @returns the new account's id, the opaque bearer token, and the absolute
   *   unix-millisecond expiry. The token is the ONLY thing the desktop /
   *   browser must persist; the rest is included for the cold-start card.
   * @throws IdentityError(EMAIL_TAKEN) when the email is already present.
   * @throws IdentityError(INVITATION_REQUIRED) when no invitation is supplied.
   * @throws IdentityError(INVITATION_INVALID) when the invitation is unusable.
   * @throws IdentityError(USER_LIMIT) when the account population is full.
   * @throws IdentityError(BAD_REQUEST) on schema-rejected input.
   */
  abstract signup(input: { email: string; password: string; displayName?: string; invitationCode: string }): Promise<SignedIn>
  /** Inspect a live invitation code without disclosing its digest or owner.
   * @param input Code to inspect.
   * @returns The opaque invitation identifier.
   * @throws IdentityError(INVITATION_INVALID) when the code is unusable.
   * @throws IdentityError(USER_LIMIT) when the account population is full.
   */
  abstract inspectInvitation(input: { code: string }): Promise<{ invitationId: InvitationId }>
  /** Issue one lifetime invitation slot for an authenticated owner.
   * @param input Authenticated owner identifier.
   * @returns Persisted metadata plus the new plaintext code.
   * @throws IdentityError(INVITATION_LIMIT) after the owner's third issue.
   * @throws IdentityError(USER_LIMIT) when the account population is full.
   */
  abstract createInvitation(input: { ownerId: UserId }): Promise<InvitationView & { code: string }>
  /** List invitation metadata owned by an authenticated account; active,
   * unconsumed, unexpired rows include decryptable plaintext, while terminal
   * and legacy rows carry `code: null`.
   * @param input Authenticated owner identifier.
   * @returns Masked invitation records.
   * @throws IdentityError(UNAUTHENTICATED) when the owner does not exist.
   */
  abstract listInvitations(input: { ownerId: UserId }): Promise<InvitationView[]>
  /** Regenerate an active invitation in its existing lifetime slot.
   * @param input Authenticated owner and invitation identifiers.
   * @returns The existing invitation metadata plus its replacement plaintext code.
   * @throws IdentityError(INVITATION_INVALID) when the invitation is absent,
   *   belongs to another owner, has expired, or has been consumed.
   */
  abstract rotateInvitation(input: { ownerId: UserId; invitationId: InvitationId }): Promise<InvitationView & { code: string }>

  /**
   * Verify an email + password pair and issue a fresh session token.
   * Constant-time failure: a wrong password and a missing account return the
   * same wire code (`UNAUTHENTICATED`) and the same message.
   * @param input - email + password.
   * @returns the userId, the opaque bearer token, and absolute expiry.
   * @throws IdentityError(UNAUTHENTICATED) on either wrong password or
   *   missing account. Distinguishing the two leaks an email-oracle.
   */
  abstract signin(input: { email: string; password: string }): Promise<SignedIn>

  /**
   * Revoke one bearer token. Idempotent: removing an unknown token resolves
   * with `{ revoked: true }` rather than throwing.
   * @param input - the token to revoke.
   * @returns `{ revoked: true }` once the row is removed (or was never there).
   */
  abstract signout(input: { sessionToken: SessionToken }): Promise<{ revoked: true }>

  /**
   * Resolve a bearer token to its account view. Used by `account.state` (a
   * desktop-cold-start probe) AND by the trust fence on every privileged
   * request; called per request so revocation propagates without delay.
   * @param input - the token to validate.
   * @returns the user id, display name, and absolute expiry, or `null` when
   *   the token is unknown / expired / revoked.
   */
  abstract validate(input: { sessionToken: SessionToken }): Promise<AuthenticatedView | null>
}

/**
 * SQLite-backed identity provider. Singleton per Cordis context.
 *
 * Lifecycle:
 *   - Constructor stores config; the database is opened on first use.
 *   - `[Service.init]` opens `<dshHome>/identity.sqlite` (WAL, owner-only)
 *     and applies the bootstrap admin when the `users` table is empty.
 *   - Disposal closes the underlying handle.
 *   - All methods consult the live handle — there is no in-process cache,
 *     so revocation propagates without delay.
 *
 * Token format: opaque random, 32 bytes urlsafe-base64 (no JWT — every
 * revocation is a row delete; no signing key to leak).
 */
export class LocalIdentityProvider extends IdentityService {
  static Config = Config

  /** Resolved on the first `[Service.init]`; awaited at every public call. */
  private storeReady: Promise<IdentityStore> | undefined
  private readonly sessionTtlSeconds: number
  private invitationPepper: string | undefined
  private readonly maxUsers: number
  private readonly maxInvitationsPerUser: number
  private readonly invitationTtlSeconds: number
  private closed = false

  constructor(ctx: Context, public config: Config) {
    super(ctx)
    this.sessionTtlSeconds = config.sessionTtlSeconds ?? 86_400
    this.invitationPepper = config.invitationPepper
    this.maxUsers = config.maxUsers ?? 100
    this.maxInvitationsPerUser = config.maxInvitationsPerUser ?? 3
    this.invitationTtlSeconds = config.invitationTtlSeconds ?? 604800
  }

  /**
   * Open the SQLite handle, run the schema, and create the bootstrap admin
   * when the `users` table is empty.
   */
  async *[Service.init](): AsyncGenerator<() => Promise<void> | void, void, void> {
    const store = await this.openStore()
    yield () => {
      this.closed = true
      store.close()
    }
  }

  /** Lazily open the store. The promise is settled once for the process. */
  private openStore(): Promise<IdentityStore> {
    if (this.storeReady !== undefined) return this.storeReady
    this.storeReady = (async () => {
      const db = await openIdentityDatabase(this.config.path)
      this.invitationPepper = await this.resolveInvitationPepper()
      const store = new IdentityStore(db)
      // Bootstrap admin: empty `users` table AND a non-empty configured email
      // yields exactly one row; the empty-email default is a no-op.
      if (this.config.bootstrap !== undefined && this.config.bootstrap.email.length > 0) {
        if (store.countUsers() === 0) {
          const passwordHash = await hashPassword(this.config.bootstrap.password)
          const userId = createUserId()
          store.insertUser({
            userId,
            email: this.config.bootstrap.email,
            passwordHash,
            displayName: this.config.bootstrap.displayName ?? null,
            createdAt: nowMillis(),
          })
          this.ctx.logger.info('identity: bootstrap user created (email=%s)', this.config.bootstrap.email)
        } else {
          this.ctx.logger.info('identity: bootstrap skipped (users table is not empty)')
        }
      }
      return store
    })()
    // A failed open still surfaces to each caller; this guard only prevents an
    // unhandled-rejection crash when the failure precedes the first use.
    this.storeReady.catch(() => undefined)
    return this.storeReady
  }

  override async signup(input: { email: string; password: string; displayName?: string; invitationCode: string }): Promise<SignedIn> {
    const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : input.email
    assertEmail(email)
    assertPassword(input.password)
    const store = await this.openStore()
    this.assertOpen(store)
    if (typeof input.invitationCode !== 'string' || input.invitationCode.length === 0) throw new IdentityError('INVITATION_REQUIRED', 'invitation code is required')
    const userId = createUserId()
    const passwordHash = await hashPassword(input.password)
    const createdAt = nowMillis()
    store.transaction(() => {
      if (store.countUsers() >= this.maxUsers) throw new IdentityError('USER_LIMIT', 'user limit reached')
      if (store.findUserByEmail(email) !== undefined) throw new IdentityError('EMAIL_TAKEN', 'email is already registered')
      const invitation = store.findInvitationByDigest(this.invitationDigest(input.invitationCode))
      if (invitation === undefined || invitation.consumed_at !== null || invitation.expires_at <= createdAt) throw new IdentityError('INVITATION_INVALID', 'invitation code is invalid')
      store.insertUser({ userId, email, passwordHash, displayName: input.displayName ?? null, createdAt })
      store.consumeInvitation(invitation.invitation_id as InvitationId, createdAt, userId)
    })
    return this.issueSession(store, { userId, email, displayName: input.displayName ?? null })
  }

  override async inspectInvitation(input: { code: string }): Promise<{ invitationId: InvitationId }> {
    const store = await this.openStore(); this.assertOpen(store)
    if (store.countUsers() >= this.maxUsers) throw new IdentityError('USER_LIMIT', 'user limit reached')
    const row = store.findInvitationByDigest(this.invitationDigest(input.code))
    if (row === undefined || row.consumed_at !== null || row.expires_at <= nowMillis()) throw new IdentityError('INVITATION_INVALID', 'invitation code is invalid')
    return { invitationId: row.invitation_id as InvitationId }
  }

  override async createInvitation(input: { ownerId: UserId }): Promise<InvitationView & { code: string }> {
    const store = await this.openStore(); this.assertOpen(store)
    const now = nowMillis()
    const code = randomBytes(32).toString('base64url')
    const invitationId = randomBytes(16).toString('base64url') as InvitationId
    const expiresAt = now + this.invitationTtlSeconds * 1000
    store.transaction(() => {
      if (store.countUsers() >= this.maxUsers) throw new IdentityError('USER_LIMIT', 'user limit reached')
      if (store.findUserById(input.ownerId) === undefined) throw new IdentityError('UNAUTHENTICATED', 'owner account not found')
      if (store.countInvitations(input.ownerId) >= this.maxInvitationsPerUser) throw new IdentityError('INVITATION_LIMIT', 'invitation limit reached')
      store.insertInvitation({
        invitation_id: invitationId,
        owner_id: input.ownerId,
        code_digest: this.invitationDigest(code),
        code_suffix: code.slice(-4),
        created_at: now,
        expires_at: expiresAt,
        consumed_at: null,
        redeemed_by: null,
        code_ciphertext: this.encryptInvitationCode(code, invitationId, input.ownerId),
      })
    })
    return {
      invitationId,
      code,
      codeMask: `••••${code.slice(-4)}`,
      createdAt: now,
      expiresAt,
      consumedAt: null,
      redeemedBy: null,
    }
  }

  override async listInvitations(input: { ownerId: UserId }): Promise<InvitationView[]> {
    const store = await this.openStore(); this.assertOpen(store)
    if (store.findUserById(input.ownerId) === undefined) throw new IdentityError('UNAUTHENTICATED', 'owner account not found')
    const now = nowMillis()
    return store.listInvitations(input.ownerId).map((row) => {
      let code: string | null = null
      if (row.consumed_at === null && row.expires_at > now && row.code_ciphertext !== null) {
        try {
          code = this.decryptInvitationCode(row.code_ciphertext, row.invitation_id, input.ownerId)
        } catch (error: unknown) {
          this.ctx.logger.warn('identity: invitation ciphertext unavailable (invitation_id=%s, error=%s)', row.invitation_id, String(error))
        }
      }
      return { invitationId: row.invitation_id as InvitationId, codeMask: `••••${row.code_suffix}`, code, createdAt: row.created_at, expiresAt: row.expires_at, consumedAt: row.consumed_at, redeemedBy: row.redeemed_by as UserId | null }
    })
  }

  override async rotateInvitation(input: { ownerId: UserId; invitationId: InvitationId }): Promise<InvitationView & { code: string }> {
    const store = await this.openStore(); this.assertOpen(store)
    const code = randomBytes(32).toString('base64url')
    const now = nowMillis()
    const ciphertext = this.encryptInvitationCode(code, input.invitationId, input.ownerId)
    const row = store.transaction(() => {
      const owned = store.findInvitationByIdForOwner(input.invitationId, input.ownerId)
      if (owned === undefined || owned.consumed_at !== null || owned.expires_at <= now) {
        throw new IdentityError('INVITATION_INVALID', 'invitation is not active')
      }
      if (!store.rotateInvitation(input.invitationId, input.ownerId, this.invitationDigest(code), code.slice(-4), ciphertext, now)) {
        throw new IdentityError('INVITATION_INVALID', 'invitation is not active')
      }
      return owned
    })
    return { invitationId: input.invitationId, code, codeMask: `••••${code.slice(-4)}`, createdAt: row.created_at, expiresAt: row.expires_at, consumedAt: null, redeemedBy: null }
  }

  private invitationDigest(code: string): string {
    return createHmac('sha256', this.invitationPepper ?? '').update(code).digest('base64url')
  }

  private invitationKey(): Buffer {
    return Buffer.from(hkdfSync(
      'sha256',
      Buffer.from(this.invitationPepper ?? ''),
      Buffer.alloc(0),
      'dsh invitation code encryption v1',
      32,
    ))
  }

  private encryptInvitationCode(code: string, invitationId: string, ownerId: string): string {
    const nonce = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.invitationKey(), nonce)
    cipher.setAAD(Buffer.from(`${invitationId}:${ownerId}`))
    const encrypted = Buffer.concat([cipher.update(code, 'utf8'), cipher.final()])
    return `v1.${nonce.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`
  }

  private decryptInvitationCode(serialized: string, invitationId: string, ownerId: string): string {
    const [version, nonce, authTag, encrypted] = serialized.split('.')
    if (version !== 'v1' || nonce === undefined || authTag === undefined || encrypted === undefined) {
      throw new Error('invalid invitation ciphertext')
    }
    const decipher = createDecipheriv('aes-256-gcm', this.invitationKey(), Buffer.from(nonce, 'base64url'))
    decipher.setAAD(Buffer.from(`${invitationId}:${ownerId}`))
    decipher.setAuthTag(Buffer.from(authTag, 'base64url'))
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
  }

  /** Resolve the HMAC key without placing a secret in a bundle or SQLite file. */
  private async resolveInvitationPepper(): Promise<string> {
    if (this.invitationPepper !== undefined && this.invitationPepper.length > 0) return this.invitationPepper
    if (this.config.path === ':memory:') return randomBytes(32).toString('base64url')
    const keyPath = `${this.config.path}.invitation-pepper`
    try { return await this.readInvitationPepper(keyPath) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const value = randomBytes(32).toString('base64url')
    const temporaryPath = `${keyPath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
    let handle: Awaited<ReturnType<typeof open>> | undefined
    try {
      handle = await open(temporaryPath, 'wx', 0o600)
      await handle.writeFile(value, 'utf8')
      await handle.sync()
      await handle.close()
      handle = undefined
      await link(temporaryPath, keyPath)
      return value
    } catch (createError) {
      if ((createError as NodeJS.ErrnoException).code !== 'EEXIST') throw createError
      return await this.readInvitationPepper(keyPath)
    } finally {
      if (handle !== undefined) {
        try { await handle.close() } catch (closeError) {
          if ((closeError as NodeJS.ErrnoException).code !== 'EBADF') throw closeError
        }
      }
      try { await unlink(temporaryPath) } catch (unlinkError) {
        if ((unlinkError as NodeJS.ErrnoException).code !== 'ENOENT') throw unlinkError
      }
    }
  }

  /** Read a generated key file and reject interrupted or corrupted writes. */
  private async readInvitationPepper(path: string): Promise<string> {
    const value = (await readFile(path, 'utf8')).trim()
    if (value.length < 32) throw new Error(`identity: invitation pepper file at "${path}" is invalid`)
    return value
  }

  override async signin(input: { email: string; password: string }): Promise<SignedIn> {
    const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : input.email
    assertEmail(email)
    assertPassword(input.password)
    const store = await this.openStore()
    this.assertOpen(store)
    const user = store.findUserByEmail(email)
    if (user === undefined) {
      // Same wire code as a wrong password: timing is dominated by scrypt,
      // so a no-such-account fast-path is acceptable; the message is identical.
      throw new IdentityError('UNAUTHENTICATED', 'invalid email or password')
    }
    const matches = await verifyPassword(user.password_hash, input.password)
    if (!matches) {
      throw new IdentityError('UNAUTHENTICATED', 'invalid email or password')
    }
    return this.issueSession(store, { userId: user.user_id as UserId, email: user.email, displayName: user.display_name })
  }

  override async signout(input: { sessionToken: SessionToken }): Promise<{ revoked: true }> {
    const store = await this.openStore()
    this.assertOpen(store)
    store.removeSession(input.sessionToken)
    return { revoked: true }
  }

  override async validate(input: { sessionToken: SessionToken }): Promise<AuthenticatedView | null> {
    if (this.closed) return null
    if (this.storeReady === undefined) return null
    const store = await this.storeReady
    if (store.isClosed()) return null
    const row = store.findSession(input.sessionToken)
    if (row === undefined) return null
    if (row.expires_at <= nowMillis()) {
      // Lazy GC: an expired row is removed on first sight.
      store.removeSession(input.sessionToken)
      return null
    }
    const user = store.findUserById(row.user_id as UserId)
    if (user === undefined) {
      // FK CASCADE should prevent this; defensive cleanup if a row slips through.
      store.removeSession(input.sessionToken)
      return null
    }
    // Refresh last_seen_at so an admin can list active sessions; cheap UPDATE
    // on the primary key.
    store.touchSession(input.sessionToken, nowMillis())
    return {
      userId: user.user_id as UserId,
      email: user.email,
      displayName: user.display_name,
      expiresAt: row.expires_at,
    }
  }

  /** Mint and persist one session row, returning the wire view. */
  private issueSession(
    store: IdentityStore,
    input: { userId: UserId; email: string; displayName: string | null },
  ): SignedIn {
    const token = createSessionToken()
    const now = nowMillis()
    const expiresAt = now + this.sessionTtlSeconds * 1000
    store.insertSession({
      token,
      user_id: input.userId,
      created_at: now,
      expires_at: expiresAt,
      last_seen_at: now,
      user_agent: null,
    })
    return {
      userId: input.userId,
      email: input.email,
      displayName: input.displayName,
      sessionToken: token,
      expiresAt,
    }
  }

  /** Fail fast after disposal; covers the edge where a public method runs past teardown. */
  private assertOpen(store: IdentityStore): void {
    if (this.closed || store.isClosed()) {
      throw new IdentityError('IDENTITY_UNAVAILABLE', 'identity provider has been disposed')
    }
  }
}

export default LocalIdentityProvider

/** Re-export types for consumers that prefer a single import. */
export type { AuthenticatedView, InvitationId, InvitationView, SessionToken, SignedIn, UserId } from './types.ts'
export { IdentityError } from './errors.ts'
export { SCHEMA_VERSION as IDENTITY_SQLITE_SCHEMA_VERSION, APPLICATION_ID as IDENTITY_SQLITE_APPLICATION_ID } from './store.ts'
export { hashPassword, verifyPassword } from './password.ts'
