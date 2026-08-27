/**
 * Credential store. Persists the xiaowei bearer-session envelope at rest via
 * Electron's `safeStorage`. Non-secret connection preferences use a separate
 * JSON file so changing execution environments never invokes OS key storage.
 *
 * Version history:
 * - v1: apiKey / tenantId / actorId (my-agents legacy); loaded-and-dropped.
 * - v2: baseUrl only (loopback / nginx-fronted trust-fence flow).
 * - v3: baseUrl + sessionToken / userId / displayName / expiresAt
 *   (xiaowei multi-user backend; the bearer token rides Authorization
 *   header on every privileged request and survives cold start).
 *
 * v2 → v3 is forward-compatible: old blobs load with `sessionToken`
 * undefined and behave identically to v2. v1 fields are read once and
 * discarded so a downgrade blob doesn't break boot.
 *
 * Trust: the trust fence on `dsh-client-connection` requires the request
 * Host to match one of `trustedHosts`. The bearer header is an additional
 * authority gate for privileged methods (`account.wallet.credit` etc.);
 * the public methods (`account.signup|signin|signout|emailCode`) ignore it.
 */
import { app, safeStorage } from 'electron'
import { promises as fsp } from 'node:fs'
import path from 'node:path'

const CREDENTIAL_FILENAME = 'credentials.bin'
const CONNECTION_FILENAME = 'connection.json'
const CREDENTIAL_VERSION = 3
const CONNECTION_VERSION = 2

interface PersistedConnection {
  version: number
  baseUrl: string
  lastLocation: 'local' | 'cloud'
}

interface PersistedCredentials {
  version: number
  /** Legacy fields (v1); loaded-and-dropped on read so old blobs don't break boot. */
  apiKey?: string
  tenantId?: string
  actorId?: string
  /** v2: loopback / nginx-fronted baseUrl. */
  baseUrl: string
  environment?: 'local' | 'cloud'
  /** v3: xiaowei multi-user bearer session; undefined on v2 blobs. */
  sessionToken?: string
  userId?: string
  /** `null` is preserved as a real value (user cleared their displayName). */
  displayName?: string | null
  /** ISO-8601 absolute expiry (string form keeps the type simple). */
  expiresAt?: string
}

export interface Credentials {
  baseUrl: string
  lastLocation?: 'local' | 'cloud'
  /** Bearer token issued by `account.signup` / `account.signin`; undefined when signed-out. */
  sessionToken?: string
  userId?: string
  /** `null` is a real value (the user never set a displayName); `undefined` = signed-out. */
  displayName?: string | null
  /** Absolute unix-millisecond expiry of the current session, if any. */
  expiresAt?: number
}

export class CredentialStore {
  private cache: Credentials

  constructor(private readonly defaultBaseUrl: string) {
    this.cache = { baseUrl: defaultBaseUrl, lastLocation: 'cloud' }
  }

  private filePath(): string {
    return path.join(app.getPath('userData'), CREDENTIAL_FILENAME)
  }

  private connectionFilePath(): string {
    return path.join(app.getPath('userData'), CONNECTION_FILENAME)
  }

  async load(): Promise<Credentials> {
    let migratedLegacyConnection = false
    try {
      const raw = await fsp.readFile(this.filePath())
      if (!safeStorage.isEncryptionAvailable()) {
        this.cache = { baseUrl: this.defaultBaseUrl, lastLocation: 'cloud' }
      } else {
        const plain = safeStorage.decryptString(raw)
        const parsed = JSON.parse(plain) as PersistedCredentials
        if (typeof parsed.baseUrl === 'string' && parsed.baseUrl.length > 0) {
          // v3 fields are optional — a v2 blob keeps working without an
          // explicit upgrade write. expiresAt round-trips as unix-millis in
          // memory (string on disk, number after parse). displayName stays
          // as `null` when explicitly cleared so a sign-out-then-restore
          // round-trip preserves the user's choice.
          const expiresAt = parsed.expiresAt !== undefined
            ? Number.parseInt(parsed.expiresAt, 10)
            : undefined
          const lastLocation = parsed.environment === 'local' ? 'local' as const : 'cloud' as const
          migratedLegacyConnection = parsed.environment === undefined
          this.cache = {
            baseUrl: parsed.baseUrl,
            lastLocation,
            sessionToken: parsed.sessionToken,
            userId: parsed.userId,
            displayName: parsed.displayName,
            expiresAt: Number.isFinite(expiresAt) ? expiresAt : undefined,
          }
        }
      }
    } catch {
      this.cache = { baseUrl: this.defaultBaseUrl, lastLocation: 'cloud' }
    }
    let connectionLoaded = false
    try {
      const raw = await fsp.readFile(this.connectionFilePath(), 'utf8')
      const parsed = JSON.parse(raw) as {
        version?: number
        baseUrl?: string
        lastLocation?: 'local' | 'cloud'
        environment?: 'local' | 'cloud'
      }
      const lastLocation = parsed.version === CONNECTION_VERSION
        && (parsed.lastLocation === 'local' || parsed.lastLocation === 'cloud')
        ? parsed.lastLocation
        : parsed.version === 1 && (parsed.environment === 'local' || parsed.environment === 'cloud')
          ? parsed.environment
          : undefined
      if (typeof parsed.baseUrl === 'string' && parsed.baseUrl.length > 0 && lastLocation !== undefined) {
        connectionLoaded = true
        this.cache = { ...this.cache, baseUrl: parsed.baseUrl, lastLocation }
      }
    } catch {
      // A missing or malformed non-secret preference file leaves migrated
      // credential values, or the local default, unchanged.
    }
    if (migratedLegacyConnection && !connectionLoaded) {
      // v2/v3 credential blobs were created by the cloud Xiaowei client. Make
      // that migration durable so a fresh launch never reinterprets them as
      // the new local default. This file contains no secret material.
      await this.saveConnection({ baseUrl: this.cache.baseUrl, lastLocation: 'cloud' })
    }
    return this.cache
  }

  /** Persist non-secret connection preferences without accessing OS key storage. */
  async saveConnection(input: Pick<Credentials, 'baseUrl' | 'lastLocation'> & { environment?: 'local' | 'cloud' }): Promise<void> {
    const lastLocation = input.lastLocation ?? input.environment ?? this.cache.lastLocation ?? 'cloud'
    const payload: PersistedConnection = {
      version: CONNECTION_VERSION,
      baseUrl: input.baseUrl,
      lastLocation,
    }
    const target = this.connectionFilePath()
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`
    await fsp.mkdir(path.dirname(target), { recursive: true })
    try {
      await fsp.writeFile(temporary, `${JSON.stringify(payload)}\n`, { mode: 0o600 })
      await fsp.rename(temporary, target)
      await fsp.chmod(target, 0o600)
    } catch (error) {
      await fsp.rm(temporary, { force: true }).catch(() => undefined)
      throw error
    }
    this.cache = { ...this.cache, baseUrl: input.baseUrl, lastLocation }
  }

  /**
   * Persist the full credentials record. Pass `sessionToken: undefined`
   * explicitly to clear the bearer (sign-out): the `save({ baseUrl })`
   * form preserves the token, while `save({ baseUrl, sessionToken: undefined,
   * userId: undefined, ... })` writes a v2-equivalent blob.
   */
  async save(input: Credentials): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('safeStorage encryption is not available on this platform')
    }
    const payload: PersistedCredentials = {
      version: CREDENTIAL_VERSION,
      baseUrl: input.baseUrl,
    }
    if (input.sessionToken !== undefined) payload.sessionToken = input.sessionToken
    if (input.userId !== undefined) payload.userId = input.userId
    if (input.displayName !== undefined) payload.displayName = input.displayName
    if (input.expiresAt !== undefined) payload.expiresAt = String(input.expiresAt)
    const encrypted = safeStorage.encryptString(JSON.stringify(payload))
    const target = this.filePath()
    await fsp.mkdir(path.dirname(target), { recursive: true })
    await fsp.writeFile(target, encrypted, { mode: 0o600 })
    await fsp.chmod(target, 0o600)
    this.cache = { ...input }
    await this.saveConnection(input)
  }

  snapshot(): Credentials {
    return { ...this.cache }
  }

  /**
   * Project the persisted session onto the renderer-facing `AuthState`
   * discriminated union. Returns `{ signedIn: false }` when any of
   * `sessionToken` / `userId` / `expiresAt` is missing; the renderer uses
   * this in two places — the cold-start `useAuthStore.refresh()` probe
   * and the IPC handler that broadcasts on every sign-in / sign-out.
   */
  authState(): { signedIn: false } | { signedIn: true; userId: string; displayName: string | null; expiresAt: number } {
    const snap = this.cache
    if (snap.sessionToken === undefined || snap.userId === undefined || snap.expiresAt === undefined) {
      return { signedIn: false }
    }
    return {
      signedIn: true,
      userId: snap.userId,
      displayName: snap.displayName ?? null,
      expiresAt: snap.expiresAt,
    }
  }
}
