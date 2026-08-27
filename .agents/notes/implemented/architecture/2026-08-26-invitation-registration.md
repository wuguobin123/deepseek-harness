# Agent Note: Invitation registration and referral limits

Status: implemented

English | [中文](2026-08-26-invitation-registration.zh.md)

## Problem

Open signup lets any network caller create a Xiaowei account and recursively consume hosted model and storage resources. A single shared password or deployment-wide invitation cannot attribute invitations to an account, cap referral growth, or revoke one leaked credential without disrupting every user.

## Decision

The identity provider owns invitation rows in the identity database. Invitation redemption, account insertion, and the final population check run under one SQLite writer transaction. Xiaowei defaults to a 100-account population limit, counting bootstrap and existing accounts, and every account can issue three lifetime single-use invitations. A registered recipient signs in with its own password and receives an independent three-invitation allowance.

Invitation creation, listing, and rotation require an authenticated account principal and always derive the owner from that principal. Storage retains an HMAC-SHA256 digest for redemption and an AES-256-GCM ciphertext for later owner access. The encryption key is derived from the invitation pepper through HKDF-SHA256 with domain separation, and authenticated data binds the ciphertext to its invitation and owner identifiers. A configured secret supplies the pepper, or the file-backed provider atomically creates an owner-only sibling key file.

An owner's invitation list includes the full value only while the code is unconsumed, unexpired, and has encrypted plaintext. Consumed and expired rows expose masked metadata only. Rows created before encrypted storage remain masked because an HMAC digest cannot recover the original value. The owner may explicitly rotate one such active row; rotation replaces its digest, suffix, and ciphertext in place, invalidates the old value, and does not consume another lifetime invitation slot.

Signup email verification is keyed by normalized email, signup purpose, and invitation identifier. The public email-code preflight rejects an unusable invitation before sending, and signup verifies the same binding before the identity transaction. The desktop registration form requires the share code, while authenticated account settings keep active codes visible and copyable and require confirmation before regenerating a legacy code.

## Verification

[Identity invitation tests](../../../../packages/account/identity/tests/invitation.spec.ts) cover defaults, expiry, three lifetime issues, inherited allowances, concurrent single redemption, concurrent final-slot admission, encrypted persistence across reopen, plaintext absence at rest, masked terminal states, legacy rotation, and owner-only key permissions. [API composition tests](../../../../packages/host/apiproxy/tests/api-proxy-invitations.spec.ts) cover account-principal ownership, email binding, registration, full active-code listing, rotation, and child allowances. [Connection tests](../../../../packages/client/connection/tests/node-half.host.spec.ts) pin the authenticated-method fence. [Desktop contract tests](../../../../apps/desktop/tests/contracts.test.ts) and [account UI tests](../../../../apps/desktop/tests/signin-card.test.tsx) pin full-code copy and explicit legacy regeneration.

## Alternatives considered

**Require the invitation at every signin.** This makes the invitation a shared second password, prevents clean per-account revocation, and forces recipients to retain a credential that is already consumed at registration.

**Keep invitations in a separate provider database.** Two SQLite databases cannot atomically consume an invitation and create an account. Reservation and compensation would add recoverable intermediate states without improving this single-host deployment.

**Return unused invitation slots after expiry.** Recyclable slots permit unlimited code generation and make the three-person referral limit ambiguous. A lifetime issuance limit is simple to inspect.

**Store invitation plaintext directly.** Plaintext storage would make a database copy sufficient to redeem every active invitation. Authenticated encryption preserves repeat owner access without accepting that exposure.

**Automatically rotate legacy codes.** Silent rotation would invalidate a value that an owner may already have shared. Explicit rotation keeps that destructive choice with the owner.

## Consequences

The design provides attributable, bounded referral growth and prevents both invitation replay and population-limit races. Existing and bootstrap accounts consume population slots and receive invitation allowances, so a database with 100 users cannot issue or redeem another code. Expired or otherwise unused codes still consume their owner's lifetime allowance.

The repeatable owner view makes an active code easier to distribute without weakening single use, expiry, account ownership, or the lifetime issuance limit. Compromise of the database alone does not disclose the codes, but compromise of both the database and invitation pepper can decrypt active values. Access control and backup handling therefore remain part of the security posture.

Identity schema version 3 deliberately rejects an existing version 2 database under the repository's pre-release policy. Deploying this source therefore requires a separately authorized backup and offline migration that adds nullable ciphertext storage; migrated legacy rows remain masked. SMTP and installed-client acceptance must follow because source-level verification does not prove those layers.
