# Xiaowei independent Business Gateway acceptance

English | [中文](xiaowei-business-gateway-acceptance.zh.md)

Date: 2026-09-01

## Result

Production now routes `https://business.xiaowei.internal/metrics/*` through the independently supervised `dsh-business-gateway.service` on `127.0.0.1:18082`. The existing Xiaowei Host remained PID `274578`, started at `2026-09-01 13:17:54 CST`, before deployment, after nginx reload, after Gateway revision 2, after business Skill revision 3, and after installed-client question-and-answer acceptance.

The Gateway remained PID `331311`, started at `2026-09-01 15:05:19 CST`, while its configuration changed atomically from revision 1 with two operations to revision 2 with three operations. This proves that a registered read action and its dynamic grant can become available without restarting either process.

## Data and authorization evidence

Before cutover, direct loopback probes returned 9 registered accounts and 3 consumed invitation codes through the two migrated operations. These values are observations of mutable production data. The unconfigured third path returned 404. Invalid bearer credentials returned 401; permission mismatch, tenant identity, unknown user, and an existing user without a grant returned 403 in focused or production probes.

After the atomic revision 2 update, `share-code-unused` returned 200 with count 0 through both the loopback listener and the internal HTTPS connection. The update did not expose SQL, a credential, raw account identity, or tenant identity in configuration. Configuration and the dedicated environment file are `root:root` mode `0600`.

The audit file is `root:root` mode `0600`. The installed-client call produced an `ok` record for `/metrics/share-code-unused` with a subject hash and no raw account id or credential. The Gateway returns 503 without a business result when audit persistence fails, as covered by the real HTTP test.

## Installed-client evidence

The authenticated Xiaowei 0.3.44 client published `xiaowei-business-metrics` revision 3, manifest version 1.1.0, with three operations. The publication request carried only `manifestText` and `expectedRevision`; account ownership came from the existing desktop authentication state.

A new cloud Session asked for the authenticated owner's unused share-code count. The transcript contains `business_skill_call · share-code-unused` and returned `未使用分享码数量：0` with observation time `2026-09-01T07:11:37.365Z`. The matching Gateway audit outcome is `ok`.

## Deterministic checks

The following focused checks passed:

```sh
pnpm exec vitest run packages/business/gateway/tests/gateway.spec.ts --config vitest.config.ts
pnpm exec tsc -b packages/business/gateway/tsconfig.host.json --pretty false
pnpm exec oxlint packages/business/gateway/src packages/business/gateway/tests --deny-warnings
pnpm exec tsdown --config packages/business/gateway/tsdown.config.ts
```

The test suite contains nine tests over real temporary HTTP and SQLite instances. It covers all three registered actions, owner scope, strict configuration fields, duplicate and unsafe mappings, database-root confinement, the authorization matrix, request input rejection, service credential failure, same-instance hot addition, invalid last-good retention, owner-only secret-free audit, and audit fail-closed behavior.

## Recovery

The pre-cutover inventory and checksummed configuration/database backup is `/opt/dsh-business-gateway-backup-20260901T065355Z`. To roll back execution without changing account or Skill data, restore `/etc/nginx/conf.d/xiaowei-business-internal.conf` from that backup, run `nginx -t`, reload nginx, and then stop `dsh-business-gateway.service`. Do not restore or delete `identity.sqlite`, `business-skills.sqlite`, Gateway configuration, or audit data as part of an upstream rollback.
