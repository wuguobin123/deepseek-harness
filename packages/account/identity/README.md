# @deepseek-ai/dsh-account-identity

English | [中文](README.zh.md)

Local identity provider for the xiaowei multi-user deployment: account signup / signin / signout, opaque bearer tokens, and the `IdentityService` Service Definition mounted as `ctx.identity`. Single-package pre-release stance — the abstract `IdentityService` and the sole `LocalIdentityProvider` live together; a hosted IdP would split this seam.

## On-disk format

`<dshHome>/identity.sqlite`, owner-only (`0o600`), parent directory owner-only (`0o700`), SQLite `journal_mode = WAL`. Schema version lives in `PRAGMA user_version`; the application id `0x44534849` (`DSHI`) is stamped in `PRAGMA application_id` to keep another tool from squatting the file.

Three tables:

- `users(user_id, email UNIQUE, password_hash, display_name, created_at)`
- `sessions(token PRIMARY KEY, user_id FK → users ON DELETE CASCADE, created_at, expires_at, last_seen_at, user_agent)`
- `invitations(invitation_id, owner_id, code_digest UNIQUE, code_suffix, code_ciphertext, created_at, expires_at, consumed_at, redeemed_by)`; the digest validates redemption while authenticated encryption keeps an active code available to its owner.

Invitation codes use AES-256-GCM at rest. The encryption key is derived from `invitationPepper` through HKDF-SHA256 with invitation-specific domain separation, and associated data binds the ciphertext to its invitation and owner identifiers. SQLite never stores plaintext codes.

Password hashes use Node `crypto.scrypt` (no new dep):

```
scrypt$N=16384$r=8$p=1$<salt-base64url>$<hash-base64url>
```

`salt` is 16 random bytes, `hash` is 64 bytes. The `N/r/p` triple is carried in the encoded form so a future migration can re-verify with stronger cost without rejecting existing rows.

Session tokens are 32 random bytes urlsafe-base64. They are NOT JWTs — there is no signing key, every revocation is a row delete, and `validate()` reads the row directly.

## Service surface

```ts
import { Service } from '@deepseek-ai/cordis'
import type { AuthenticatedView, InvitationId, InvitationView, SessionToken, SignedIn, UserId } from '@deepseek-ai/dsh-account-identity'

declare module '@deepseek-ai/cordis' {
  interface Context { identity: IdentityService }
}

abstract class IdentityService extends Service {
  abstract signup(input: { email: string; password: string; displayName?: string; invitationCode: string }): Promise<SignedIn>
  abstract inspectInvitation(input: { code: string }): Promise<{ invitationId: InvitationId }>
  abstract createInvitation(input: { ownerId: UserId }): Promise<InvitationView & { code: string }>
  abstract listInvitations(input: { ownerId: UserId }): Promise<InvitationView[]>
  abstract rotateInvitation(input: { ownerId: UserId; invitationId: InvitationId }): Promise<InvitationView & { code: string }>
  abstract signin(input: { email: string; password: string }): Promise<SignedIn>
  abstract signout(input: { sessionToken: SessionToken }): Promise<{ revoked: true }>
  abstract validate(input: { sessionToken: SessionToken }): Promise<AuthenticatedView | null>
}
```

Configuration includes `invitationPepper`, `maxUsers` (100), `maxInvitationsPerUser` (3), and `invitationTtlSeconds` (604800). The pepper supplies both the redemption HMAC key and an independently derived encryption key. When no pepper is supplied, a 32-byte owner-only key is atomically created beside the database; memory databases generate an ephemeral key. Signup consumes the code and inserts the user in one `BEGIN IMMEDIATE` transaction.

`LocalIdentityProvider` opens its database in `[Service.init]`, creates the bootstrap admin when `users` is empty, and serves every method through the same handle. There is no in-process cache, so revocation propagates without delay.

## Wire methods

`packages/host/apiproxy/src/api/account.ts` exposes:

- `account.signup({ email, password, displayName?, invitationCode })` → `{ userId, displayName, sessionToken, expiresAt }`
- `account.emailCode({ email, invitationCode })` → an invitation-bound email-verification lifetime and retry delay
- `account.invites.create({})` → account-owned metadata plus the full newly created code
- `account.invites.list({})` → account-owned metadata plus a full code for each active unconsumed invitation whose encrypted value is available
- `account.invites.rotate({ invitationId })` → replaces one active invitation's code without consuming another lifetime slot and returns its new full value
- `account.signin({ email, password })` → same shape
- `account.signout({ sessionToken })` → `{ revoked: true }`
- `account.state({ sessionToken })` → `{ userId, displayName, expiresAt } | { signedIn: false }`

Signup, email-code, and signin are public only after the Host/trusted-authority check; signup still requires a live invitation. Invitation creation, listing, and rotation require a validated account bearer and derive the owner from that principal. Lists omit plaintext for consumed, expired, and legacy digest-only rows. Rotation requires an explicit owner action, invalidates the replaced value, and does not add an invitation row. Host management methods remain loopback-only.

`signin` returns the same wire code (`UNAUTHENTICATED`) and the same message for a wrong password and a missing account — distinguishing them leaks an email-oracle.

## Composition

A bundle row mounts the provider with its configuration:

```yaml
- id: identity
  name: '@deepseek-ai/dsh-account-identity'
  config:
    path: !!js dshHomePath('identity.sqlite')
    maxUsers: 100
    maxInvitationsPerUser: 3
    invitationTtlSeconds: 604800
    bootstrap:
      email: !!js process.env.XIAOWEI_ADMIN_EMAIL || ''
      password: !!js process.env.XIAOWEI_ADMIN_PASSWORD || ''
```

The trust fence connection row must inject the provider:

```yaml
- id: connection
  inject: [webRuntime, identity]
```

`packages/client/connection/src/api-request-auth.ts` reads `Authorization: Bearer …` and validates it through `ctx.identity.validate()`; a valid token grants the privileged method gate alongside the existing loopback-only `isTrustedApiRequest(request, [])` shortcut.

## Model Experience

None, as the provider authenticates host requests and never reaches a model request body or prompt.

#### KV Cache effect

None. Tokens never enter a prompt; they only attach to outbound HTTP headers that the model never sees.

## Known Limitations and Deferred Work

- **scrypt N=16384 is the Node stdlib minimum** — a future migration can bump N (the parameters are in the encoded hash) but should ship a verification path that accepts both old and new rows.
- **Invitation registration is limited to the configured cohort** — a future PR introduces `account.admin.*` privileged methods (loopback-only) for ban / disable / setQuota; this PR does not.
- **No password reset flow** — out of scope; PR 2 step 10.1b can add a wallet-bound reset if needed.
- **Single SQLite file per deployment** — multi-tenant deployments will need one file per tenant; current scope is single-tenant xiaowei.
- **Bootstrap admin is single-account** — it seeds the referral tree by creating invitations; additional accounts still follow the ordinary invitation registration path.
- **Legacy invitation plaintext cannot be recovered** — rows created before encrypted code storage remain masked until their owner explicitly rotates an active code. Deployment requires the repository's authorized offline schema migration before schema version 3 can open existing production data.
