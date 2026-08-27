# 用户凭据

[English](credentials.md) | 中文

[dsh-credentials](../../packages/credentials/credentials) 的凭据 seam 把机密挡在配置之外：settings 分节与 `cordis.yml` 条目携带的是*引用*（环境变量名），值归 [dsh-credentials-local](../../packages/credentials/credentials-local) 这类提供方所有，消费方每个操作解析一次引用——LLM（大语言模型）适配器每次模型请求解析一次，因此轮换后的凭据无需任何重启即可作用于紧随其后的下一次请求。一条 seam 级规则约束每个提供方：空的存储值在任何地方都视为不存在。

来源：[`packages/credentials/credentials/src/index.ts`](../../packages/credentials/credentials/src/index.ts)

## 标识

引用以 POSIX 风格环境变量名命名一条凭据。brand 防止调用方将凭据引用与在包或进程之间传递的其他字符串混用；构造时校验 shell 标识符语法。

```ts type-equiv
/** Nominal reference to one credential: a POSIX-style environment-variable name. */
type CredentialRef = Branded<'CredentialRef'>
```

## 解析

`resolve(ref)` 返回值及提供该值的来源层（由提供方定义）；未配置期间返回 `undefined`。消费方在每个操作中重新解析，绝不跨操作缓存——这种按操作进行的读取正是热更新机制。

```ts type-equiv
/** One resolved credential value and the source layer that supplied it. */
interface ResolvedCredential {
  /** The non-empty secret value. */
  value: string
  /** Provider-defined source layer id (the local provider uses `env`, `file`, `project-env`, and `user-env`). */
  source: string
}
```

## 描述

`describe(ref)` 在绝不暴露值的前提下回应配置界面：引用当前是否可解析、来自哪一层、`set` 当前能否成功。本地提供方把由当前进程环境供值的引用报告为 `writable: false`——那样的写入会表面成功而解析持续返回遮蔽值，因此 seam 直接拒绝，界面也得以提前把该引用渲染为只读。

```ts type-equiv
/** Source and writability facts for one reference, safe for configuration UIs — never the value. */
interface CredentialInfo {
  /** Whether {@link CredentialProvider.resolve} would currently return a value. */
  configured: boolean
  /** Source layer currently supplying the value; absent while unconfigured. */
  source?: string
  /** Whether {@link CredentialProvider.set} would currently succeed for this reference. */
  writable: boolean
}
```

## 已提交的变更

`credentials/reference-updated (ref)` 在提供方管理的来源发生已提交变更后发出——`set`、`unset` 或在存储中观察到的外部编辑。进程环境自身的变化不可观测，永不发出事件。消费方不需要该事件（它们按操作重新解析）；它服务于配置界面刷新「已配置」徽标。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxauthorization--authorizationservice"></a>

### `ctx.authorization` — `AuthorizationService`

`ctx.authorization`: a registry of credential-obtaining flows, one attempt at a time per key.

```ts cordis-catalog
/**
 * Offer a way to obtain one credential. One flow per key: two plugins
 * claiming the same key would each write a record in their own format, and
 * whichever ran last would leave the other reading a payload it cannot parse.
 *
 * @param flow - the key it writes, its label, its methods, and its runner.
 * @returns Disposer that withdraws this flow.
 * @throws {AuthorizationError} code `DUPLICATE_FLOW` when the key is already claimed.
 */
registerFlow(flow: AuthorizationFlow): () => void

/**
 * Every registered flow, for a surface listing what can be authorized.
 * @returns one entry per flow, in registration order.
 */
list(): readonly AuthorizationEntry[]

/**
 * One registered flow.
 * @param key - the credential record to ask about.
 * @returns the entry, or undefined when no flow claims that key.
 */
describe(key: CredentialKey): AuthorizationEntry | undefined

/**
 * Withdraw the attempt running for a key, if any. Separate from the
 * request's own signal because a request/response transport answers a Cancel
 * button on a second call, with no handle on the first one's signal.
 * @param key - the credential record whose attempt should stop.
 */
cancel(key: CredentialKey): void

/**
 * Run one attempt to authorize a key, and report how it ended.
 *
 * One attempt per key at a time. A second caller is refused rather than
 * joined: the two would be prompting different humans through the same flow,
 * and the second would answer questions the first was asked.
 *
 * @param request - the key, the method, the surface, and the cancel signal.
 * @returns `authorized` once the flow's record is committed during this
 *   attempt and observed, or `cancelled` when the human declined or the
 *   caller withdrew.
 * @throws {AuthorizationError} code `NO_FLOW` when nothing claims the key,
 *   `UNKNOWN_METHOD` when the named method is not one the flow offers,
 *   `ALREADY_IN_FLIGHT` when an attempt is already running for the key, or
 *   `NOT_COMMITTED` when the flow resolved without committing a record
 *   during the attempt.
 */
async begin(request: AuthorizationRequest): Promise<AuthorizationOutcome>
```

Source: [`packages/credentials/authorization/src/index.ts`](../../packages/credentials/authorization/src/index.ts)

<a id="ctxcredentials--credentialprovider-abstract-seam"></a>

### `ctx.credentials` — `CredentialProvider` (abstract seam)

Abstract credential service over two key spaces that answer two questions.

A CredentialRef answers "what is behind this environment-variable name", layered over the process environment, the provider-managed store, and `.env` files. One seam-wide rule binds that half: an empty stored value is absent everywhere — `resolve` skips it, `describe` reports it unconfigured — so a blank never masquerades as a configured secret.

A CredentialKey answers "what credential does this plugin hold for this id". Nothing can layer here — an authorization grant has no environment to be read from — so presence of the record is the whole fact, and modifyRecord is the only write path because a correct write depends on the current value (a token refresh is read-decide-replace under one lock).

```ts cordis-catalog
/**
 * Resolve one reference to its current value. Resolution is per call:
 * consumers re-resolve at each operation and must not cache across
 * operations — that per-operation read is what makes a changed credential
 * reach the next operation without a restart.
 * @param ref - the reference to resolve.
 * @returns the value and its source, or `undefined` while unconfigured.
 */
abstract resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined>

/**
 * Describe one reference for configuration surfaces without exposing the
 * value.
 * @param ref - the reference to describe.
 * @returns configured state, supplying source, and writability.
 */
abstract describe(ref: CredentialRef): Promise<CredentialInfo>

/**
 * Durably store one value in the provider-managed writable source. Rejects
 * while a read-only source shadows the reference — the write would appear
 * to succeed while resolution keeps returning the shadowing value — and
 * rejects an empty value (use {@link unset}).
 * @param ref - the reference to store.
 * @param value - the non-empty secret value.
 */
abstract set(ref: CredentialRef, value: string): Promise<void>

/**
 * Remove one reference from the provider-managed writable source; removing
 * an absent reference is a no-op. Rejects while a read-only source shadows
 * the reference, like {@link set}.
 * @param ref - the reference to remove.
 */
abstract unset(ref: CredentialRef): Promise<void>

/**
 * Read one stored record. The value is returned as its owner wrote it; a
 * {@link GrantRecord} payload is not interpreted on the way out.
 * @param key - the record to read.
 * @returns the record, or `undefined` while none is stored.
 */
abstract readRecord(key: CredentialKey): Promise<CredentialRecord | undefined>

/**
 * Describe one record for configuration surfaces without exposing its value.
 * @param key - the record to describe.
 * @returns presence, discriminant, and writability.
 */
abstract describeRecord(key: CredentialKey): Promise<CredentialRecordInfo>

/**
 * Enumerate every stored record's address and tag. Unlike the reference
 * half, which has no enumeration because configuration surfaces learn which
 * references exist from settings schemas, records have no such discovery
 * path: a surface that cannot list them cannot show what a user is
 * authorized for, nor find an orphan left by an uninstalled plugin.
 * @returns every stored record, values excluded.
 */
abstract listRecords(): Promise<readonly CredentialRecordEntry[]>

/**
 * Serialized read-modify-write over one record — the only write path.
 * `mutate` sees the record as it stands at the moment the write is
 * exclusive, and returning `undefined` leaves the entry untouched. Exclusion
 * holds across processes where the backing store supports it, which is what
 * makes a token refresh safe: two processes rotating one refresh token
 * concurrently would otherwise lose whichever wrote first.
 * @param key - the record to modify.
 * @param mutate - receives the current record and returns its replacement, or `undefined` to leave it.
 * @returns the record after the write, or the current one when `mutate` declined.
 */
abstract modifyRecord( key: CredentialKey, mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>, ): Promise<CredentialRecord | undefined>

/**
 * Remove one record; removing an absent record is a no-op.
 * @param key - the record to remove.
 */
abstract deleteRecord(key: CredentialKey): Promise<void>
```

Source: [`packages/credentials/credentials/src/index.ts`](../../packages/credentials/credentials/src/index.ts)

<a id="ctxemailverification--emailverificationservice-abstract-seam"></a>

### `ctx.emailVerification` — `EmailVerificationService` (abstract seam)

The Service Definition. Wire methods project its two public methods.

Implementations MUST be safe to call concurrently from the same Cordis context — the host-side RPC handlers do not serialize requests.

```ts cordis-catalog
/**
 * Whether the seam is wired. `false` means `verifyCode` becomes a no-op.
 * @returns `true` when verification gates `signup`; `false` when the seam
 *   is disabled and `verifyCode` is a pass-through.
 */
abstract isEnabled(): boolean

/**
 * Mint and dispatch a fresh 6-digit code to the given email.
 * @param input.email The email address the code is dispatched to.
 * @returns The TTL and resend cooldown the renderer should advertise.
 * @throws EmailVerificationError on bad input, cooldown, rate-limit, lockout,
 *   or transport failure. The host layer maps these to wire codes.
 */
abstract requestCode(input: { email: string }): Promise<EmailCodeRequestResult>

/**
 * Verify a code against the row that `requestCode` produced.
 * @param input.email The email address the code was sent to.
 * @param input.code The 6-digit candidate code the caller is asserting.
 * @returns `true` when the code matches and the row is within TTL and not
 *   locked. The verified row is deleted so the same code cannot be reused.
 * @throws EmailVerificationError on bad input, missing row, wrong code,
 *   expired code, or lockout. Errors that increment the attempts counter
 *   are reflected in the row before the throw.
 */
abstract verifyCode(input: { email: string; code: string }): Promise<boolean>
```

Source: [`packages/account/email-verification/src/index.ts`](../../packages/account/email-verification/src/index.ts)

<a id="ctxidentity--identityservice-abstract-seam"></a>

### `ctx.identity` — `IdentityService` (abstract seam)

The Service Definition for the identity seam. Every implementation owns one `users` table and one `sessions` table; cross-process or hosted IdPs would extend this contract without changing the wire shape.

```ts cordis-catalog
/**
 * Create one account and return an immediately-valid session.
 * @param input - email + password + optional display name.
 * @returns the new account's id, the opaque bearer token, and the absolute
 *   unix-millisecond expiry. The token is the ONLY thing the desktop /
 *   browser must persist; the rest is included for the cold-start card.
 * @throws IdentityError(EMAIL_TAKEN) when the email is already present.
 * @throws IdentityError(BAD_REQUEST) on schema-rejected input.
 */
abstract signup(input: { email: string; password: string; displayName?: string }): Promise<SignedIn>

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
```

Source: [`packages/account/identity/src/index.ts`](../../packages/account/identity/src/index.ts)

<a id="ctxusermodelkeys--usermodelkeyservice-abstract-seam"></a>

### `ctx.userModelKeys` — `UserModelKeyService` (abstract seam)

The Service Definition. Every implementation owns one `user_model_keys` table; hosted / Stripe-backed providers would extend this contract without changing the wire shape.

```ts cordis-catalog
/**
 * Ensure one active upstream credential for this user and provider route.
 * @param input.userId The user the key is issued for.
 * @param input.label Optional human label (default from `Config.defaultLabel`).
 * @returns Metadata for the active credential. The bearer token remains internal.
 * @throws ModelKeyError when configured key material or upstream issuance fails.
 * @throws ModelKeyError when the upstream issuer cannot ensure a credential.
 */
abstract provision(input: { userId: UserId; label?: string }): Promise<ProvisionedKey>

/**
 * List metadata for every key owned by `userId`, newest first.
 * @param input.userId The user whose key metadata is queried.
 * @returns Newest-first key metadata rows (never the plaintext `keyValue`).
 */
abstract list(input: { userId: UserId }): Promise<ModelKeyView[]>

/**
 * Mark `keyId` as revoked. Idempotent — revoking an unknown or already-
 * revoked key resolves with `revoked: false` rather than throwing.
 * @param input.keyId The key row id to revoke.
 * @returns `{ revoked: true }` if this call closed a live row; `false`
 *   if the row was unknown or already revoked.
 */
abstract revoke(input: { keyId: KeyId }): Promise<{ revoked: boolean }>

/**
 * Resolve the encrypted active upstream token for model execution.
 * @param input.userId User whose credential is needed.
 * @param input.route Optional provider route filter.
 * @returns Internal credential metadata and token, or undefined when absent.
 */
abstract resolveActive(input: { userId: UserId; route?: string }): Promise<ActiveModelCredential | undefined>

/**
 * Create one account-owned custom model with an encrypted API key.
 * @param input - Owner, public endpoint metadata, upstream model, and write-only key.
 * @returns Public metadata without the API key.
 */
abstract createCustom(input: { userId: UserId; label: string; api: 'openai-completions' | 'openai-responses'; baseURL: string; upstreamModel: string; apiKey: string }): Promise<CustomModelView>

/**
 * List custom models for one account.
 * @param input - Account whose records are listed.
 * @returns Newest-first metadata without API keys.
 */
abstract listCustom(input: { userId: UserId }): Promise<CustomModelView[]>

/**
 * Revoke one custom model only when owned by the account.
 * @param input - Account and opaque custom-model id.
 * @returns Whether this call revoked an active owned row.
 */
abstract removeCustom(input: { userId: UserId; customModelId: CustomModelId }): Promise<{ removed: boolean }>

/**
 * Resolve one custom model only when owned by the account.
 * @param input - Account and opaque custom-model id.
 * @returns Decrypted internal record, or undefined when unavailable.
 */
abstract resolveCustom(input: { userId: UserId; customModelId: CustomModelId }): Promise<ResolvedCustomModel | undefined>
```

Source: [`packages/account/model-keys/src/index.ts`](../../packages/account/model-keys/src/index.ts)

<a id="ctxwallet--walletservice-abstract-seam"></a>

### `ctx.wallet` — `WalletService` (abstract seam)

The Service Definition for the wallet seam. Every implementation owns one `wallets` table and one `wallet_ledger` table; cross-process or hosted providers (Stripe, new-api, etc.) would extend this contract without changing the wire shape.

```ts cordis-catalog
/**
 * Fetch the wallet view for one user. Returns a zero-balance view when the
 * user has no row yet; this is the same default the bootstrap path inserts.
 * @param input.userId The user whose wallet view is requested.
 * @returns A `WalletView` snapshot of the current balance and timestamp.
 */
abstract get(input: { userId: UserId }): Promise<WalletView>

/**
 * Add `amountMicros` to the user's balance and append a ledger row.
 * @param input The credit payload.
 * @returns The new wallet view after the credit is applied.
 * @throws WalletError(BAD_REQUEST) on schema-rejected input.
 */
abstract credit(input: { userId: UserId; amountMicros: number; reason: LedgerReason; idempotencyKey?: string }): Promise<WalletView>

/**
 * Subtract `amountMicros` from the user's balance; throws when the result
 * would be negative.
 * @param input The debit payload.
 * @returns The new wallet view after the debit is applied.
 * @throws WalletError(INSUFFICIENT_BALANCE) when the balance cannot cover.
 */
abstract debit(input: { userId: UserId; amountMicros: number; reason: LedgerReason; idempotencyKey?: string }): Promise<WalletView>

/**
 * Force the balance to `balanceMicros` and append a `set-quota` ledger row.
 * Admin-privileged; wire-layer fence restricts callers to loopback.
 * @param input The quota override payload.
 * @returns The new wallet view after the override is applied.
 */
abstract setQuota(input: { userId: UserId; balanceMicros: number; reason: LedgerReason }): Promise<WalletView>

/**
 * Apply the configured daily-refresh amount once. Idempotent by date: a
 * second call with the same `idempotencyKey` returns the prior balance
 * without applying a second delta.
 * @param input The refresh payload (must carry today's idempotency key).
 * @returns The wallet view after the refresh (or the existing one when
 *   the key was already applied today).
 */
abstract refreshDaily(input: { userId: UserId; idempotencyKey: string }): Promise<WalletView>

/**
 * Apply the configured welcome bonus. Convenience for `credit`.
 * @param input The user id to credit.
 * @returns The new wallet view after the welcome bonus is applied.
 */
abstract grantWelcomeBonus(input: { userId: UserId }): Promise<WalletView>

/**
 * Return the most-recent ledger entries, newest first.
 * @param input.userId The user whose ledger is queried.
 * @param input.limit Optional cap on returned rows (server default applies
 *   when omitted).
 * @returns Newest-first ledger rows.
 */
abstract listLedger(input: { userId: UserId; limit?: number }): Promise<LedgerEntry[]>

/** Reserve available balance without changing the reported current balance.
 * @param input.userId Account owning the reservation.
 * @param input.reservationId Stable 1..64-character operation identifier.
 * @param input.amountMicros Non-negative safe-integer amount to hold.
 * @returns The durable active reservation; an exact retry returns the same record.
 * @throws WalletError on invalid input, conflicting identity, or insufficient available balance.
 */
abstract reserve(input: { userId: UserId; reservationId: string; amountMicros: number }): Promise<WalletReservation>

/** Settle a reservation and charge actual model usage.
 * @param input.userId Account owning the reservation.
 * @param input.reservationId Reservation to settle.
 * @param input.actualMicros Non-negative usage, no greater than reserved amount.
 * @param input.idempotencyKey Stable ledger idempotency key.
 * @returns The committed settlement; an exact retry returns the same result.
 * @throws WalletError on missing/cancelled reservations, parameter drift, or invalid input.
 */
abstract settle(input: { userId: UserId; reservationId: string; actualMicros: number; idempotencyKey: string }): Promise<WalletSettlement>

/** Cancel a reservation and release its hold without writing a ledger row.
 * @param input.userId Account owning the reservation.
 * @param input.reservationId Reservation to cancel.
 * @returns The durable reservation record; repeated cancellation returns the same record.
 * @throws WalletError when the reservation is missing or already settled.
 */
abstract cancel(input: { userId: UserId; reservationId: string }): Promise<WalletReservation>
```

Source: [`packages/account/wallet/src/index.ts`](../../packages/account/wallet/src/index.ts)

<a id="authorization-events"></a>

### `authorization/*` events

<a id="authorizationsettled--emit"></a>

#### `authorization/settled` — emit

One authorization attempt has finished and released its key. Fires for every terminal outcome, failures included, so a surface watching a key it did not start (a second browser tab) learns the attempt is over.

```ts cordis-catalog
/**
 * One authorization attempt has finished and released its key. Fires for
 * every terminal outcome, failures included, so a surface watching a key it
 * did not start (a second browser tab) learns the attempt is over.
 * @mode emit
 * @param key - the credential record the finished attempt was authorizing.
 * @param settlement - how it ended, including the `failed` case its caller sees as a thrown error.
 */
'authorization/settled'(key: CredentialKey, settlement: AuthorizationSettlement): void
```

Source: [`packages/credentials/authorization/src/index.ts`](../../packages/credentials/authorization/src/index.ts)

<a id="credentials-events"></a>

### `credentials/*` events

<a id="credentialsrecord-updated--emit"></a>

#### `credentials/record-updated` — emit

Committed change to a stored credential record: a `modifyRecord` that wrote, a `deleteRecord` that removed, or an external edit observed in storage. Separate from `credentials/reference-updated` because the two key grammars are disjoint — a listener that received both on one event could not tell which space a subject belongs to. Listener failures are contained on the same terms as `credentials/reference-updated`.

```ts cordis-catalog
/**
 * Committed change to a stored credential record: a `modifyRecord` that
 * wrote, a `deleteRecord` that removed, or an external edit observed in
 * storage. Separate from `credentials/reference-updated` because the two key
 * grammars are disjoint — a listener that received both on one event could
 * not tell which space a subject belongs to. Listener failures are
 * contained on the same terms as `credentials/reference-updated`.
 * @param key - the record whose stored value changed.
 * @mode emit
 */
'credentials/record-updated'(key: CredentialKey): void
```

Source: [`packages/credentials/credentials/src/types.ts`](../../packages/credentials/credentials/src/types.ts)

<a id="credentialsreference-updated--emit"></a>

#### `credentials/reference-updated` — emit

Committed change to a provider-managed credential source: a `set`, an `unset`, or an external edit observed in storage. Ambient process-environment changes are not observable and never emit. Listener failures are contained and logged — a sync throw and an async rejection alike — without changing the committed operation's outcome, except `INVARIANT`-coded failures, which rethrow after every listener ran; that rethrow reaches the emitter only from synchronous listeners, so invariant checks on this event must not be async functions.

```ts cordis-catalog
/**
 * Committed change to a provider-managed credential source: a `set`, an
 * `unset`, or an external edit observed in storage. Ambient
 * process-environment changes are not observable and never emit. Listener
 * failures are contained and logged — a sync throw and an async rejection
 * alike — without changing the committed operation's outcome, except
 * `INVARIANT`-coded failures, which rethrow after every listener ran;
 * that rethrow reaches the emitter only from synchronous listeners, so
 * invariant checks on this event must not be async functions.
 * @param ref - the reference whose stored value changed.
 * @mode emit
 */
'credentials/reference-updated'(ref: CredentialRef): void
```

Source: [`packages/credentials/credentials/src/types.ts`](../../packages/credentials/credentials/src/types.ts)
<!-- END GENERATED cordis-surface -->
