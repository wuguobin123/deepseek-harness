# Xiaowei registered-user details acceptance

English | [中文](xiaowei-registered-user-details-acceptance.zh.md)

Date: 2026-09-01

## Result

Production runs Gateway configuration revision 3 and account-private `xiaowei-business-metrics` Skill revision 4, manifest version 1.2.0. The new `registered-user-details` operation returns a fixed first page of at most ten items. Each item contains only `maskedEmail` and day-precision `registeredDate`; the envelope contains only `items`, `page`, `pageSize`, `hasMore`, and `observedAt`.

The deployment restarted only `dsh-business-gateway.service`, changing its PID from `331311` to `359705`. Xiaowei remained PID `274578`, started at `2026-09-01 13:17:53 CST`. The subsequent configuration revision 3 hot update did not change either PID.

## Authorization and data evidence

The production loopback probe returned HTTP 200 with nine safe detail items on page one, `pageSize: 10`, and `hasMore: false`. It reported both the exact item field set and envelope field set as safe without printing the returned values. The existing account count, used share-code count, and unused share-code count operations continued to return HTTP 200.

The operation requires `users.details.read`. The seed script adds that grant only to an existing subject-hashed grant that already contains `metrics.accounts.read`; the Gateway still checks the exact operation permission on every request. Missing or incorrect bearer credentials, permission mismatches, tenant headers, and unknown users remain rejected. Neither `userId` nor `tenantId` is accepted as business input.

The final state probe found four Gateway operations, one subject-hashed grant, no service credential or raw requester identity in configuration or audit, and audit mode `0600`. A successful `/metrics/registered-user-details` audit record contains only `at`, `operation`, `outcome`, and `subjectHash`.

## Installed-client evidence

The authenticated Xiaowei 0.3.44 client validated and published Skill revision 4 through the account RPC. The first two installed-client attempts stopped before tool dispatch because the only configured model, MiniMax-M3, returned temporary cluster-load error `PI_AI_ERROR (2064)`. A third new Session completed after the provider recovered.

The successful transcript contains `business_skill_call · registered-user-details`, nine masked-email results, and nine registration dates. The acceptance probe found no unmasked email token or forbidden identity, tenant, display-name, or password field. The matching Gateway audit record at `2026-09-01T08:01:57.117Z` has outcome `ok` and contains only `at`, `operation`, `outcome`, and `subjectHash`.

## Deterministic checks

The following checks passed:

```sh
pnpm exec vitest run packages/business/gateway/tests/gateway.spec.ts --config vitest.config.ts
pnpm exec tsc -b packages/business/gateway/tsconfig.host.json --pretty false
pnpm exec oxlint packages/business/gateway/src packages/business/gateway/tests --deny-warnings
pnpm exec tsdown --config packages/business/gateway/tsdown.config.ts
pnpm run verify-sdd
pnpm run verify-agent-note-format
```

The focused suite contains fourteen tests over real temporary HTTP and SQLite instances. It covers deterministic pagination, terminal pages, day precision, masking, forbidden-field absence, independent authorization, invalid page and identity input, request-body rejection, UTF-8 response limits, detail-free audit, all three existing operations, hot reload, and the complete revision 3 seed configuration.

## Recovery

The verified pre-deployment backup is `/opt/dsh-business-gateway-backup-20260901T074738Z`. Roll back the account Skill to revision 3 first, restore the backed-up revision 2 Gateway configuration atomically, and restore the backed-up Gateway artifact only if execution rollback is also required. Do not restart Xiaowei and do not restore or delete identity, Session, account, or Skill databases.
