/**
 * Credential store. Wraps Electron's `safeStorage` to encrypt the API key at
 * rest. On macOS the encrypted blob is written to a 0600 file under
 * `app.getPath('userData')`. On platforms without `safeStorage` (rare on
 * supported platforms), we fall back to refusing to persist — the user must
 * re-enter the key each session.
 */
import { app, safeStorage } from 'electron';
import { promises as fs } from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';

const CREDENTIAL_FILENAME = 'credentials.bin';
const CREDENTIAL_VERSION = 1;
const LEGACY_LOCAL_BASE_URLS = new Set([
  'http://127.0.0.1:8080',
  'http://localhost:8080',
  'http://127.0.0.1:8001',
  'http://localhost:8001'
]);
const CURRENT_LOCAL_BASE_URL = 'http://127.0.0.1:8000';

interface PersistedCredentials {
  version: number;
  apiKey: string;
  tenantId: string;
  actorId: string;
  baseUrl: string;
}

function migrateLegacyLocalCredentials(
  credentials: Credentials
): Credentials {
  const normalizedBaseUrl = credentials.baseUrl?.replace(/\/$/, '') ?? null;
  return {
    ...credentials,
    baseUrl:
      normalizedBaseUrl && LEGACY_LOCAL_BASE_URLS.has(normalizedBaseUrl)
        ? CURRENT_LOCAL_BASE_URL
        : credentials.baseUrl
  };
}

export interface Credentials {
  apiKey: string | null;
  tenantId: string | null;
  actorId: string | null;
  baseUrl: string | null;
}

export class CredentialStore {
  private cache: Credentials = {
    apiKey: null,
    tenantId: null,
    actorId: null,
    baseUrl: null
  };

  private filePath(): string {
    return path.join(app.getPath('userData'), CREDENTIAL_FILENAME);
  }

  async load(): Promise<Credentials> {
    try {
      const raw = await fsp.readFile(this.filePath());
      if (!safeStorage.isEncryptionAvailable()) {
        // We refuse to return an unencrypted key. Treat as no credentials.
        this.cache = { apiKey: null, tenantId: null, actorId: null, baseUrl: null };
        return this.cache;
      }
      const plain = safeStorage.decryptString(raw);
      const parsed = JSON.parse(plain) as PersistedCredentials;
      if (parsed.version !== CREDENTIAL_VERSION) {
        this.cache = { apiKey: null, tenantId: null, actorId: null, baseUrl: null };
        return this.cache;
      }
      const loaded = {
        apiKey: parsed.apiKey,
        tenantId: parsed.tenantId,
        actorId: parsed.actorId,
        baseUrl: parsed.baseUrl
      };
      this.cache = migrateLegacyLocalCredentials(loaded);
      if (
        this.cache.baseUrl !== loaded.baseUrl
      ) {
        try {
          await this.save(this.cache);
        } catch {
          // Keep the safe in-memory migration even if persistence is
          // temporarily unavailable; the next successful save will retain it.
        }
      }
      return this.cache;
    } catch {
      this.cache = { apiKey: null, tenantId: null, actorId: null, baseUrl: null };
      return this.cache;
    }
  }

  async save(input: Credentials): Promise<void> {
    if (!input.apiKey) {
      throw new Error('apiKey is required to save credentials');
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('safeStorage encryption is not available on this platform');
    }
    const payload: PersistedCredentials = {
      version: CREDENTIAL_VERSION,
      apiKey: input.apiKey,
      tenantId: input.tenantId ?? '',
      actorId: input.actorId ?? '',
      baseUrl: input.baseUrl ?? ''
    };
    const encrypted = safeStorage.encryptString(JSON.stringify(payload));
    const target = this.filePath();
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, encrypted, { mode: 0o600 });
    await fs.chmod(target, 0o600);
    this.cache = input;
  }

  async clear(): Promise<void> {
    try {
      await fsp.unlink(this.filePath());
    } catch {
      // ignore — best effort
    }
    this.cache = { apiKey: null, tenantId: null, actorId: null, baseUrl: null };
  }

  snapshot(): Credentials {
    return { ...this.cache };
  }
}
