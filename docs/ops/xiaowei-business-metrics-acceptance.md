# Xiaowei business metrics Skill acceptance

English | [中文](xiaowei-business-metrics-acceptance.zh.md)

Date: 2026-09-01

## Result

The production Xiaowei Host accepts the account-private `xiaowei-business-metrics` Skill at active revision 2. The installed Xiaowei 0.3.44 client called `registered-accounts` and `share-code-usage` through `business_skill_call` and returned 9 registered accounts and 3 consumed invitation codes at `2026-09-01T05:18:36Z`. These values are observations of mutable production data rather than fixed expectations.

Publishing revision 2 advanced the active pointer without replacing the Host process. A subsequent question in the existing desktop Session resolved the new revision, proving the configuration-only hot-loading path independently from the platform deployment.

## Security evidence

The connector reaches `business.xiaowei.internal` through HTTPS on loopback. Its certificate has the internal hostname as a subject alternative name, Node trusts the deployment-owned CA, and nginx does not expose this listener publicly. The Host resolves the service credential for each call and sends the authenticated Session owner; the manifest and model input contain neither value.

Endpoint probes returned 401 for missing and invalid bearer credentials, 403 for an invalid permission, tenant header, unknown user, or ungranted user, and 405 for a non-GET request. Valid registered-account and owner-scoped invitation requests returned bounded `{count, observedAt}` responses. `userId` came from the authenticated desktop state and was never entered as a prompt or Tool argument; no tenant identity was sent because Xiaowei has no authoritative tenant-membership selection.

The durable audit file is owned by `root:root` with mode `0600`. It contains operation, status, observation time, and trace id for both denied probes and installed-client calls, and contains no service credential name or value. Audit-write failure returns 503 before a business result is disclosed.

## Deterministic evidence

Focused Vitest coverage exercises identity counts, owner scoping, connector retry and HTTPS policy, runtime trusted-context propagation, endpoint authentication, permissions, response limits, and fail-closed durable audit. The relevant TypeScript project references and production bundles compile successfully.

## Recovery evidence

The source tree before this integration is preserved at `/opt/dsh-xiaowei.pre-business-metrics-20260901T050600Z`. Deployment configuration and the two SQLite databases are preserved with checksums at `/opt/dsh-xiaowei-business-metrics-backup-20260901T045650Z`. Rollback must retain account and business-Skill databases unless the operator explicitly chooses a data rollback.
