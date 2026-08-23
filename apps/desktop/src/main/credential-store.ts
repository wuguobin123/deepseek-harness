/**
 * Credential store. Persists the dsh-ops baseUrl at rest via Electron's
 * `safeStorage`. v1 records (my-agents apiKey/tenantId/actorId) are loaded
 * once and discarded on read; the only field v2 keeps is baseUrl.
 *
 * Trust: the desktop client talks to dsh-ops over loopback (or the nginx
 * fronting it) and the trust fence on `dsh-client-connection` requires the
 * request Host to match one of `trustedHosts` (`127.0.0.1`, `localhost`,
 * `119.45.252.25`, `xiaowei.119.45.252.25.nip.io`). No auth headers are sent —
 * the trust fence is the access boundary.
 */
import { app, safeStorage } from 'electron'
import { promises as fsp } from 'node:fs'
import path from 'node:path'

const CREDENTIAL_FILENAME = 'credentials.bin'
const CREDENTIAL_VERSION = 2

interface PersistedCredentials {
  version: number
  /** Legacy fields (v1); loaded-and-dropped on read so old blobs don't break boot. */
  apiKey?: string
  tenantId?: string
  actorId?: string
  /** v2: the only field we keep. */
  baseUrl: string
}

export interface Credentials {
  baseUrl: string
}

export class CredentialStore {
  private cache: Credentials

  constructor(private readonly defaultBaseUrl: string) {
    this.cache = { baseUrl: defaultBaseUrl }
  }

  private filePath(): string {
    return path.join(app.getPath('userData'), CREDENTIAL_FILENAME)
  }

  async load(): Promise<Credentials> {
    try {
      const raw = await fsp.readFile(this.filePath())
      if (!safeStorage.isEncryptionAvailable()) {
        this.cache = { baseUrl: this.defaultBaseUrl }
        return this.cache
      }
      const plain = safeStorage.decryptString(raw)
      const parsed = JSON.parse(plain) as PersistedCredentials
      if (typeof parsed?.baseUrl !== 'string' || parsed.baseUrl.length === 0) {
        this.cache = { baseUrl: this.defaultBaseUrl }
        return this.cache
      }
      this.cache = { baseUrl: parsed.baseUrl }
      return this.cache
    } catch {
      this.cache = { baseUrl: this.defaultBaseUrl }
      return this.cache
    }
  }

  async save(input: Credentials): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('safeStorage encryption is not available on this platform')
    }
    const payload: PersistedCredentials = {
      version: CREDENTIAL_VERSION,
      baseUrl: input.baseUrl,
    }
    const encrypted = safeStorage.encryptString(JSON.stringify(payload))
    const target = this.filePath()
    await fsp.mkdir(path.dirname(target), { recursive: true })
    await fsp.writeFile(target, encrypted, { mode: 0o600 })
    await fsp.chmod(target, 0o600)
    this.cache = { baseUrl: input.baseUrl }
  }

  snapshot(): Credentials {
    return { ...this.cache }
  }
}
