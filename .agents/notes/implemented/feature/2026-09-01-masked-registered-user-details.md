# Agent Note: Masked registered-user details

Status: implemented

English | [中文](2026-09-01-masked-registered-user-details.zh.md)

## Problem

The aggregate registered-account count cannot answer operational questions about when accounts registered or distinguish detail rows. Returning the identity table directly would expose account identifiers, complete email addresses, password material, and exact activity data to the model and durable Session log.

## Decision

The closed `registered-user-page` Gateway action is protected by the independent `users.details.read` grant. It returns fixed pages of ten rows with only masked email and day-precision registration date. The Gateway accepts only an optional positive page number, executes a fixed read-only query, bounds the response, and audits only the requester subject hash and outcome.

The Skill manifest exposes the operation as `registered-user-details`; it never accepts `userId`, `tenantId`, a filter, sort expression, field selector, SQL, or credential. Registering the action restarted only the independent Gateway. Its route, grant, and account Skill revision were then enabled through hot configuration.

## Alternatives considered

**Return full identity rows.** This would disclose stable account identifiers, email addresses, password hashes, and operational metadata unrelated to the question.

**Return display names and exact timestamps.** These fields increase identification and behavioral precision without being necessary for the first operational use case.

**Reuse `metrics.accounts.read`.** Aggregate-count access does not imply permission to inspect individual records, so details use a separate grant.

## Verification

Fourteen focused tests prove minimal fields, deterministic pagination, independent authorization, invalid-input rejection, UTF-8 output bounds, detail-free audit, complete revision 3 seeding, and preservation of the three aggregate operations. Production runs Gateway configuration revision 3 and Skill revision 4. An authenticated installed-client transcript contains `business_skill_call · registered-user-details`, nine masked results, no forbidden fields, and a matching successful Gateway audit record while Xiaowei remains the same process.

## Consequences

Masked email and registration date remain personal data once combined with other information, and model-visible results persist in Session history. Page-based pagination can duplicate or skip rows if registrations occur between calls; the bounded operational view does not promise a transactionally stable export.
