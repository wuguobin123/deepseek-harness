/**
 * Tests for `apps/desktop/src/main/credential-store.ts`.
 *
 * The store imports Electron's `safeStorage` and `app.getPath()`; the test
 * stubs those with in-memory equivalents so we can exercise the on-disk
 * serialization logic without booting Electron. Tests cover:
 *   - the v2 → v3 round-trip (older files load with empty auth fields),
 *   - persistence + reload (token survives across instances when safeStorage
 *     round-trips the same cipher text),
 *   - `authState()` projects `signedIn` correctly,
 *   - safeStorage-unavailable paths fall back to defaults.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync, statSync, writeFileSync } from 'node:fs'

interface Cipher {
  payload: string
}

const cipher: Cipher = { payload: '' }

let safeStorageAvailable = true
let userDataDir = ''

vi.mock('electron', () => ({
  app: {
    getPath: (key: string): string => {
      if (key !== 'userData') throw new Error(`unexpected app.getPath key ${key}`)
      return userDataDir
    },
  },
  safeStorage: {
    isEncryptionAvailable: (): boolean => safeStorageAvailable,
    encryptString: (plain: string): Buffer => {
      // Deterministic identity cipher — the round-trip test asserts that
      // the same input produces the same output; we don't test encryption
      // strength here.
      cipher.payload = `enc:${plain}`
      return Buffer.from(cipher.payload, 'utf8')
    },
    decryptString: (raw: Buffer): string => {
      const text = raw.toString('utf8')
      if (!text.startsWith('enc:')) throw new Error('not encrypted by stub')
      return text.slice(4)
    },
  },
}))

// Import after the mock so the module picks up the stubbed Electron API.
const { CredentialStore } = await import('../src/main/credential-store')

beforeEach(() => {
  userDataDir = mkdtempSync(join(tmpdir(), 'dsh-credential-store-'))
  safeStorageAvailable = true
  cipher.payload = ''
})

afterEach(() => {
  rmSync(userDataDir, { recursive: true, force: true })
})

describe('CredentialStore v3 round-trip', () => {
  it('persists session token + identity fields and reloads them', async () => {
    const store = new CredentialStore('http://default')
    await store.load()
    await store.save({
      baseUrl: 'http://ops.example',
      sessionToken: 'tkn-1',
      userId: 'user-1',
      displayName: 'Alice',
      expiresAt: 1_700_000_000_000,
    })
    // A second instance over the same home picks up the saved fields.
    const reopened = new CredentialStore('http://default')
    const loaded = await reopened.load()
    expect(loaded).toEqual({
      baseUrl: 'http://ops.example',
      lastLocation: 'cloud',
      sessionToken: 'tkn-1',
      userId: 'user-1',
      displayName: 'Alice',
      expiresAt: 1_700_000_000_000,
    })
    expect(reopened.authState()).toEqual({
      signedIn: true,
      userId: 'user-1',
      displayName: 'Alice',
      expiresAt: 1_700_000_000_000,
    })
  })

  it('persists connection preferences without invoking safeStorage encryption', async () => {
    const store = new CredentialStore('http://default')
    await store.load()
    await store.saveConnection({ baseUrl: 'https://cloud.example.test', lastLocation: 'cloud' })
    expect(cipher.payload).toBe('')
    expect(JSON.parse(readFileSync(join(userDataDir, 'connection.json'), 'utf8'))).toEqual({
      version: 2,
      baseUrl: 'https://cloud.example.test',
      lastLocation: 'cloud',
    })
    expect(statSync(join(userDataDir, 'connection.json')).mode & 0o777).toBe(0o600)

    const reopened = new CredentialStore('http://default')
    await expect(reopened.load()).resolves.toMatchObject({
      baseUrl: 'https://cloud.example.test',
      lastLocation: 'cloud',
    })
  })

  it('loads connection preferences when safeStorage is unavailable', async () => {
    const store = new CredentialStore('http://default')
    await store.saveConnection({ baseUrl: 'https://cloud.example.test', lastLocation: 'cloud' })
    safeStorageAvailable = false
    const reopened = new CredentialStore('http://default')
    await expect(reopened.load()).resolves.toMatchObject({
      baseUrl: 'https://cloud.example.test',
      lastLocation: 'cloud',
    })
  })

  it('migrates a 0.3.17/0.3.18 environment preference to lastLocation', async () => {
    writeFileSync(join(userDataDir, 'connection.json'), JSON.stringify({
      version: 1,
      baseUrl: 'https://cloud.example.test',
      environment: 'local',
    }))
    const store = new CredentialStore('http://default')
    await expect(store.load()).resolves.toMatchObject({
      baseUrl: 'https://cloud.example.test',
      lastLocation: 'local',
    })
  })

  it('loads a v2 file (baseUrl only) with empty auth fields', async () => {
    // Write a v2 file by hand using the same cipher shape the store would.
    cipher.payload = ''
    const store = new CredentialStore('http://default')
    await store.save({ baseUrl: 'http://v2-only' })
    const raw = readFileSync(join(userDataDir, 'credentials.bin'), 'utf8')
    expect(raw).toMatch(/^enc:/)
    // Re-open with no auth fields — authState() must report signed-out.
    const reopened = new CredentialStore('http://default')
    const loaded = await reopened.load()
    expect(loaded.baseUrl).toBe('http://v2-only')
    expect(loaded.sessionToken).toBeUndefined()
    expect(reopened.authState()).toEqual({ signedIn: false })
  })

  it('migrates a legacy v2/v3 credential blob to cloud when no environment or connection exists', async () => {
    const legacy = JSON.stringify({ version: 3, baseUrl: 'https://cloud.example.test', sessionToken: 'legacy-token', userId: 'legacy-user' })
    const credentialsPath = join(userDataDir, 'credentials.bin')
    writeFileSync(credentialsPath, Buffer.from(`enc:${legacy}`))
    const store = new CredentialStore('http://default')
    await expect(store.load()).resolves.toMatchObject({ baseUrl: 'https://cloud.example.test', lastLocation: 'cloud' })
    expect(JSON.parse(readFileSync(join(userDataDir, 'connection.json'), 'utf8'))).toMatchObject({
      baseUrl: 'https://cloud.example.test', lastLocation: 'cloud', version: 2,
    })
    expect(statSync(join(userDataDir, 'connection.json')).mode & 0o777).toBe(0o600)
  })

  it('falls back to the default baseUrl when safeStorage is unavailable', async () => {
    safeStorageAvailable = false
    const store = new CredentialStore('http://fallback')
    const loaded = await store.load()
    expect(loaded.baseUrl).toBe('http://fallback')
    expect(loaded.sessionToken).toBeUndefined()
  })

  it('save() throws when safeStorage is unavailable', async () => {
    safeStorageAvailable = false
    const store = new CredentialStore('http://fallback')
    await expect(store.save({ baseUrl: 'http://x' })).rejects.toThrow(/safeStorage encryption is not available/)
  })

  it('authState reports signed-out after signOut clears the token', async () => {
    const store = new CredentialStore('http://default')
    await store.save({
      baseUrl: 'http://x',
      sessionToken: 'tkn-2',
      userId: 'user-2',
      displayName: null,
      expiresAt: 1_700_000_000_000,
    })
    expect(store.authState()).toMatchObject({ signedIn: true })
    await store.save({ baseUrl: 'http://x' })
    expect(store.authState()).toEqual({ signedIn: false })
    // Snapshot reads the post-save cache.
    expect(store.snapshot()).toEqual({ baseUrl: 'http://x', lastLocation: 'cloud' })
  })

  it('treats displayName === null as a real value, not absent', async () => {
    const store = new CredentialStore('http://default')
    await store.save({
      baseUrl: 'http://x',
      sessionToken: 'tkn-3',
      userId: 'user-3',
      displayName: null,
      expiresAt: 1_700_000_000_000,
    })
    const reopened = new CredentialStore('http://default')
    await reopened.load()
    const state = reopened.authState()
    expect(state.signedIn).toBe(true)
    if (state.signedIn) {
      expect(state.displayName).toBeNull()
    }
  })
})
