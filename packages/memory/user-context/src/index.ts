/**
 * Service Definition + default SQLite-backed provider for the xiaowei
 * user-context seam.
 *
 * Long-term memory is split into three kinds:
 *   - `preference` — user-tuned harness behavior (writing style, default model
 *     family, display theme override). Global to the user; no workspace scope.
 *   - `working`    — per-workspace scratch notes the user wants to find again
 *     next time they reopen the project. Carries `workspaceId`.
 *   - `profile`    — long-lived biographical facts (name, role, current team).
 *     Global to the user.
 *
 * The seam is model-invisible: there is no model-facing tool that reads or
 * writes user context. The harness and the desktop settings UI read it;
 * the model sees only what the user pastes into a turn. This keeps memory
 * under the user's control and out of the model's prompt budget.
 *
 * Single-package pre-release stance: the abstract `UserContextStore` and the
 * sole implementation `LocalUserContextProvider` live here together. A hosted
 * provider (K/V service) would split this seam into its own package; for now
 * the SQLite store is the only shape the harness needs.
 *
 * @module @deepseek-ai/dsh-user-context
 */
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  UserContextError,
  assertKey,
  assertKind,
  assertValue,
  assertWorkspaceId,
} from './errors.ts'
import { UserContextDb, openUserContextDatabase, nowMillis } from './store.ts'
import type {
  UserContextEntry,
  UserContextGetResult,
  UserContextKind,
  UserContextKey,
  UserContextListResult,
  UserContextValue,
} from './types.ts'

/** Plugin configuration. */
export interface Config {
  /** Path to the SQLite database file (`:memory:` for tests). */
  path: string
}

export const Config: z<Config> = z.object({
  path: z.string().required(),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The local user-context provider (Service Definition: `UserContextStore`). */
    userContext: UserContextStore
  }
}

/**
 * Service Definition for the user-context seam. Every implementation owns one
 * `user_context` table keyed on `(kind, key, workspace_id)`; cross-process or
 * hosted providers (KV service, etc.) would extend this contract without
 * changing the wire shape.
 */
export abstract class UserContextStore extends Service {
  constructor(ctx: Context) {
    super(ctx, 'userContext')
  }

  /**
   * Fetch one entry by composite key. Returns `{ found: false, missing: true }`
   * when the row is absent — callers distinguish "stored as the empty string"
   * from "no row at all" without throwing.
   * @param input.kind The memory category.
   * @param input.key The opaque slot name.
   * @param input.workspaceId Optional workspace scope; `undefined` / `null` /
   *   `''` all mean "user-global".
   * @returns The entry, or `{ found: false, missing: true }`.
   */
  abstract get(input: {
    kind: UserContextKind
    key: UserContextKey
    workspaceId?: string | null
  }): Promise<UserContextGetResult>

  /**
   * Upsert one entry. Existing rows update `value` + `updated_at`; brand-new
   * rows insert with `created_at = updated_at`. Returns the post-write entry
   * so the caller can confirm the new timestamp.
   * @param input.kind The memory category.
   * @param input.key The opaque slot name.
   * @param input.workspaceId Optional workspace scope.
   * @param input.value The string payload (UTF-8 byte length capped at 16 KiB).
   * @returns The entry after the write.
   */
  abstract set(input: {
    kind: UserContextKind
    key: UserContextKey
    workspaceId?: string | null
    value: UserContextValue
  }): Promise<UserContextEntry>

  /**
   * List entries, newest-first. Filters are optional; both unset returns
   * every row. `limit` is clamped to `[1, 1000]` (server default 200).
   * @param input.kind Optional kind filter.
   * @param input.workspaceId Optional exact workspace match; `undefined`
   *   matches user-global entries (`workspace_id = ''`) AND workspace-scoped
   *   ones (callers wanting one bucket should query twice). `null` /
   *   `''` filter only matches the global bucket.
   * @param input.limit Optional row cap.
   * @returns Matching entries sorted newest-first.
   */
  abstract list(input: {
    kind?: UserContextKind
    workspaceId?: string | null
    limit?: number
  }): Promise<UserContextListResult>

  /**
   * Delete one row by composite key. Returns `{ removed: false }` when no
   * row matched — `set` is idempotent, so the absence of a row is not an
   * error here either.
   * @param input.kind The memory category.
   * @param input.key The opaque slot name.
   * @param input.workspaceId Optional workspace scope.
   * @returns Whether a row was actually removed.
   */
  abstract delete(input: {
    kind: UserContextKind
    key: UserContextKey
    workspaceId?: string | null
  }): Promise<{ removed: boolean }>
}

/**
 * SQLite-backed user-context provider. Singleton per Cordis context.
 *
 * Lifecycle:
 *   - Constructor stores config; the database opens on first use.
 *   - `[Service.init]` opens `<dshHome>/user-context.sqlite` (WAL, owner-only)
 *     and applies the schema. No bootstrap row is created — empty install is
 *     a valid starting state.
 *   - Disposal closes the underlying handle.
 */
export class LocalUserContextProvider extends UserContextStore {
  static Config = Config

  private storeReady: Promise<UserContextDb> | undefined
  private closed = false

  constructor(ctx: Context, public config: Config) {
    super(ctx)
  }

  async *[Service.init](): AsyncGenerator<() => Promise<void> | void, void, void> {
    const store = await this.openStore()
    yield () => {
      this.closed = true
      store.close()
    }
  }

  private openStore(): Promise<UserContextDb> {
    if (this.storeReady !== undefined) return this.storeReady
    this.storeReady = (async () => {
      const db = await openUserContextDatabase(this.config.path)
      return new UserContextDb(db)
    })()
    this.storeReady.catch(() => undefined)
    return this.storeReady
  }

  override async get(input: {
    kind: UserContextKind
    key: UserContextKey
    workspaceId?: string | null
  }): Promise<UserContextGetResult> {
    assertKind(input.kind)
    assertKey(input.key)
    assertWorkspaceId(input.workspaceId)
    const store = await this.openStore()
    this.assertOpen(store)
    const entry = store.findEntry(input.kind, input.key, input.workspaceId ?? null)
    if (entry === null) return { found: false, missing: true }
    return { found: true, entry }
  }

  override async set(input: {
    kind: UserContextKind
    key: UserContextKey
    workspaceId?: string | null
    value: UserContextValue
  }): Promise<UserContextEntry> {
    assertKind(input.kind)
    assertKey(input.key)
    assertWorkspaceId(input.workspaceId)
    assertValue(input.value)
    const store = await this.openStore()
    this.assertOpen(store)
    const entry = store.upsertEntry({
      kind: input.kind,
      key: input.key,
      workspaceId: input.workspaceId ?? null,
      value: input.value,
      now: nowMillis(),
    })
    return entry
  }

  override async list(input: {
    kind?: UserContextKind
    workspaceId?: string | null
    limit?: number
  }): Promise<UserContextListResult> {
    if (input.kind !== undefined) assertKind(input.kind)
    if (input.workspaceId !== undefined) assertWorkspaceId(input.workspaceId)
    const store = await this.openStore()
    this.assertOpen(store)
    // exactOptionalPropertyTypes: omit undefined properties rather than passing them through.
    const pass: { kind?: UserContextKind; workspaceId?: string | null; limit?: number } = {}
    if (input.kind !== undefined) pass.kind = input.kind
    if (input.workspaceId !== undefined) pass.workspaceId = input.workspaceId
    if (input.limit !== undefined) pass.limit = input.limit
    return store.listEntries(pass)
  }

  override async delete(input: {
    kind: UserContextKind
    key: UserContextKey
    workspaceId?: string | null
  }): Promise<{ removed: boolean }> {
    assertKind(input.kind)
    assertKey(input.key)
    assertWorkspaceId(input.workspaceId)
    const store = await this.openStore()
    this.assertOpen(store)
    return { removed: store.deleteEntry(input.kind, input.key, input.workspaceId ?? null) }
  }

  /** Fail fast after disposal; covers the edge where a public method runs past teardown. */
  private assertOpen(store: UserContextDb): void {
    if (this.closed || store.isClosed()) {
      throw new UserContextError('USER_CONTEXT_UNAVAILABLE', 'user-context provider has been disposed')
    }
  }
}

export default LocalUserContextProvider

/** Re-export types and helpers for consumers that prefer a single import. */
export type {
  UserContextEntry,
  UserContextGetResult,
  UserContextKind,
  UserContextKey,
  UserContextListResult,
  UserContextValue,
} from './types.ts'
export { toUserContextKey } from './types.ts'
export { UserContextError } from './errors.ts'
export type { UserContextErrorCode } from './errors.ts'
export { SCHEMA_VERSION as USER_CONTEXT_SQLITE_SCHEMA_VERSION, APPLICATION_ID as USER_CONTEXT_SQLITE_APPLICATION_ID } from './store.ts'
