---
sdd:
  id: feature.xiaowei.invitation-registration
  kind: feature
  status: implemented
  owners:
    - xiaowei-platform
  requirements:
    - id: REQ-xiaowei-invitation-registration-001
      text: Xiaowei creates an account only when the request supplies a valid single-use invitation code and the account population remains below the configured limit of 100 users.
    - id: REQ-xiaowei-invitation-registration-002
      text: Every registered user may issue at most three invitation codes, each code can register at most one account, and a newly invited account receives its own three-code allowance.
    - id: REQ-xiaowei-invitation-registration-003
      text: Invitation redemption, account creation, and the final population-limit check commit in one identity-database transaction so concurrent requests cannot reuse a code or exceed the limit.
    - id: REQ-xiaowei-invitation-registration-004
      text: The service encrypts invitation plaintext at rest, never logs it, and returns a full code only for an active unconsumed invitation owned by the authenticated account; consumed and expired invitations expose masked metadata only.
    - id: REQ-xiaowei-invitation-registration-005
      text: Signup email verification is bound to the signup purpose, normalized email, and invitation so a code cannot authorize another email, purpose, or invitation.
    - id: REQ-xiaowei-invitation-registration-006
      text: An owner may explicitly regenerate an active legacy invitation whose plaintext is unavailable, invalidating the old code without consuming another lifetime invitation slot.
  acceptance:
    - id: ACC-xiaowei-invitation-registration-001
      text: Signup rejects a missing, unknown, expired, consumed, or foreign-bound invitation without creating an account, while one valid invitation creates exactly one account.
      evidence:
        - packages/account/identity/tests/invitation.spec.ts
        - packages/host/apiproxy/tests/api-proxy-invitations.spec.ts
    - id: ACC-xiaowei-invitation-registration-002
      text: One account can create three invitations and the fourth request is rejected; each invited account can create its own invitations after signup.
      evidence:
        - packages/account/identity/tests/invitation.spec.ts
        - packages/host/apiproxy/tests/api-proxy-invitations.spec.ts
    - id: ACC-xiaowei-invitation-registration-003
      text: Concurrent signup attempts for one invitation yield one account, and concurrent attempts for the final slot yield exactly the configured population limit, which is 100 in Xiaowei.
      evidence:
        - packages/account/identity/tests/invitation.spec.ts
    - id: ACC-xiaowei-invitation-registration-004
      text: Invitation lists expose the full code for the owner's active unconsumed invitations, expose no plaintext for consumed or expired invitations, database inspection finds no plaintext code, and one account cannot inspect another account's invitation records.
      evidence:
        - packages/account/identity/src/index.ts
        - packages/account/identity/tests/invitation.spec.ts
        - packages/host/apiproxy/tests/api-proxy-invitations.spec.ts
        - packages/client/connection/tests/node-half.host.spec.ts
    - id: ACC-xiaowei-invitation-registration-005
      text: The assembled Xiaowei account view keeps active invitation codes visible and copyable, offers explicit regeneration for legacy masked codes, and keeps consumed or expired codes masked.
      evidence:
        - packages/account/email-verification/tests/email-verification.spec.ts
        - packages/host/apiproxy/tests/api-proxy-invitations.spec.ts
        - apps/desktop/tests/contracts.test.ts
        - apps/desktop/tests/signin-card.test.tsx
        - apps/desktop/tests/account-invites.test.tsx
  evidence:
    - packages/bundle/xiaowei/cordis.patch.yml
    - packages/account/identity/src/index.ts
    - packages/account/email-verification/src/index.ts
    - packages/host/apiproxy/src/api-proxy.ts
    - apps/desktop/src/renderer/features/auth/SignInCard.tsx
    - apps/desktop/src/renderer/features/account/AccountSection.tsx
  decisions:
    - .agents/notes/implemented/architecture/2026-08-26-invitation-registration.md
---
# Xiaowei invitation registration

English | [中文](invitation-registration.zh.md)

## Outcome

Xiaowei limits the validation cohort to 100 registered accounts. Registration requires a single-use invitation issued by an existing account. Each account can invite three additional people, producing an owner-scoped referral tree without making the invitation a recurring login credential.

## Registration rules

The identity database counts every stored account, including bootstrap and existing accounts, toward the configured population limit. Invitation creation stops when the limit is reached, and signup repeats the limit check inside the same transaction that consumes the invitation and inserts the account. Codes issued before the final slot is filled remain visible but cannot register another account after the limit is reached.

An account receives three lifetime invitation slots. Creating an invitation consumes one slot even if the code later expires unused. An invitation is single-use, expires after the configured lifetime, and grants the registered account ordinary password login plus its own three invitation slots.

## Security rules

The service generates high-entropy codes, persists keyed digests for redemption, and separately encrypts plaintext codes at rest with an authenticated cipher. An authenticated owner can list the full value of an active unconsumed invitation so it remains copyable until use or expiration. Consumed and expired invitations return masked metadata only. The service never logs plaintext codes, and a different account cannot list or regenerate another owner's invitations. Invitation inspection does not distinguish unknown, expired, or consumed codes; invitation creation and the final signup transaction report when the validation cohort is full.

Invitations created before encrypted storage do not have recoverable plaintext. The account view marks those active codes as legacy and requires an explicit regeneration action. Regeneration replaces the code in the existing invitation record, invalidates the old value, and does not consume another lifetime invitation slot.

Signup email verification records the signup purpose and invitation identifier beside the normalized email. Successful email verification is consumed before identity creation; a later identity failure may require another email code but does not consume the invitation.

## Evidence boundary

Package tests prove database transactions, ownership, limits, and redaction. RPC and desktop tests prove the public request fields and product flow. A source or assembled-runtime result does not prove production migration, SMTP delivery, or an installed-client release.
