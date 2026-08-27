# Agent Note: Xiaowei bundle boot + backend dispatch landed end-to-end

Status: implemented

English | [中文](2026-08-24-xiaowei-bundle-and-backend-dispatch.zh.md)

## Problem

The xiaowei remote backend is half code (the `account-identity` / `account-email-verification` / `account-wallet` / `account-model-keys` service packages, the artifact registry, the api-proxy wire method modules) and half a deployment target — a Cordis bundle that the `pnpm dsh --profile xiaowei` launcher can boot into a long-running HTTP carrier that the Electron desktop client can hit. The first half landed in PR 2 step 10.1a + 10.1a.5 + 10.1b; the second half was incomplete: the bundle package did not exist, `PROFILE_TEMPLATES` had no `xiaowei` entry, the api-proxy's new `account.*` / `account.wallet.*` / `account.modelKeys.*` / `artifact.*` wire methods had no host-side route registration, the `IApiClient` interface had no corresponding stubs in either the connection or the runtime tests, and the existing `fake-api.client.ts` files rejected dispatch of any new method name. The launcher's "cannot resolve profile bundle" was the visible symptom; the hidden deficit was that no end-to-end HTTP carrier was ever bound on `XIAOWEI_PORT=18181`, so the desktop client had nothing to talk to.

## Decision

The xiaowei remote-backend PR (10.1 step 11 + the host-side glue that connects it to the desktop client) ships:

1. `packages/bundle/xiaowei/` — `@deepseek-ai/dsh-xiaowei`, a new Cordis profile bundle with three module entries (`./index.ts`, `./startup.ts`, `./invariant.ts`), a `cordis.patch.yml` that layers `account-identity` / `account-email-verification` / `account-wallet` / `account-model-keys` / `artifact-store-fs` over the `dsh-base` + `dsh-headless` stack, an `inject`-aware runner whose `apply()` is a no-op when no positional task is given, and a `xiaoweiStartup` Cordis service that publishes `{ task, port }` from `XIAOWEI_PORT` (default 18000) plus positional argv.
2. `PROFILE_TEMPLATES.xiaowei = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless', '@deepseek-ai/dsh-xiaowei']` in `packages/boot/app-boot/src/profile.ts:117`. The CLI launcher now resolves `--profile xiaowei` through the same `resolveBundleDir` path every other profile uses.
3. `@deepseek-ai/dsh-xiaowei` added to `apps/cli/package.json` dependencies so the workspace-resolved install anchor sees the bundle. Without this line, the launcher's two-anchor resolution (`installAnchor`, then `profileDir`) still misses because the dsh app's `node_modules` symlink set has no entry for the bundle.
4. The api-proxy gained 19 new `UNARY_ROUTES` entries (`packages/host/apiproxy/src/fetch/handler.ts`): `account.signup` / `account.emailCode` / `account.signin` / `account.signout` / `account.state` / `account.wallet.get` / `account.wallet.credit` / `account.wallet.setQuota` / `account.wallet.refreshDaily` / `account.modelKeys.list` / `account.modelKeys.provision` / `account.modelKeys.revoke` / `artifact.list` / `artifact.read` / `artifact.remove` (each with its zod request / value schema), and four domain blocks on the `ApiProxy` shape — `account` / `wallet` / `modelKeys` / `artifactRegistry` — wired into the `api-proxy.ts` factory's `provide('api', ...)` block. Loopback-only `account.wallet.credit` / `account.wallet.setQuota` / `account.wallet.refreshDaily` / `account.modelKeys.provision` / `account.modelKeys.revoke` sit behind `PRIVILEGED_METHODS`; `account.wallet.get` / `account.modelKeys.list` accept loopback or bearer (user reads their own row); `account.signup` / `account.signin` / `account.signout` / `account.accountEmailCode` are public (no PRIVILEGED entry).
5. `IApiClient` and `AbstractApiClient` extended with the four new domain blocks. `packages/client/connection/tests/fake-api.client.ts` and `packages/client/runtime/tests/fake-api.client.ts` got matching `readonly account / wallet / modelKeys / artifactRegistry` blocks that record the method call and return `ok(...)` envelopes. `packages/client/connection/src/client/fixture.ts` got the same four blocks plus a 19-arm `switch (method)` in `dispatch()`.
6. `packages/account/email-verification/src/index.ts` `Config` widened to accept `transportKind: z.union(['logging', 'smtp']).default('logging')` plus SMTP fields; the `LocalEmailVerificationProvider` builds a `LoggingEmailSender` or `SmtpEmailSender` from the resolved kind, and the bundle's `cordis.patch.yml` toggles transport via `transportKind: !!js "(process.env.XIAOWEI_SMTP_HOST ? 'smtp' : 'logging')"`.

The Cordis startup module (`packages/bundle/xiaowei/src/startup.ts`) publishes `{ task: <positional argv joined by space>, port: <XIAOWEI_PORT or 18000> }` onto `ctx.xiaoweiStartup`. Unlike `@deepseek-ai/dsh-headless/startup`, it does NOT `program.error` on empty argv — the long-running HTTP carrier is the normal idle state and only the foreground-task runner reacts to a non-empty task. The runner is a no-op when `ctx.xiaoweiStartup.task` is empty; with a task it drives a single turn through `ctx.agents` and prints the final assistant message.

Three patches beyond the bootstrap were needed to make the boot actually succeed.

**YAML `!!js` scalars must be double-quoted when the JS expression contains `:` followed by whitespace.** The `entryListSchema` is `yaml.JSON_SCHEMA.extend(JsExpr)`; YAML parses a `: ` sequence *outside* a quoted scalar as the mapping key/value separator. The expression `(process.env.XIAOWEI_SMTP_HOST ? 'smtp' : 'logging')` loaded as a single block scalar parses cleanly; the same expression as a plain `!!js` scalar fails with `{"[object Object]":"logging"}` — the runtime sees an object whose one key is the literal string `"[object Object]"`. Double-quoting every `!!js` value (and not relying on `!!js` itself to suppress YAML flow) makes the entire patch file load. This is documented inline in `packages/bundle/xiaowei/cordis.patch.yml:99`.

**`artifact-store-fs` already registers `ArtifactRegistry`; the bare `artifact` row in the same `- insert` block is a double-registration** that throws `service "artifactRegistry" has been registered at <LocalArtifactRegistry>` at the api-proxy mount step. The bare row was removed; only `artifact-store-fs` remains. The abstract `@deepseek-ai/dsh-artifact` package exists for type declaration merging only and is not a loader entry.

**The xiaowei profile inherits `dsh-headless`, whose `headless-startup` calls `program.error` on empty argv.** That trips before the xiaowei webserver has a chance to bind. The xiaowei patch adds `- id: headless-startup / disabled: true` and the same for `headless-runner`; the long-running HTTP carrier becomes the only entry-point. The dsh-headless core (agent, session, llm) is left intact and only its one-shot glue is replaced.

## Consequences

`pnpm dsh --profile xiaowei` now boots into a long-running HTTP carrier on `XIAOWEI_PORT` (default 18000). The following wire methods verified via `curl` against the live process return their full envelope:

- `account.emailCode({ email })` → `{ expiresInSeconds: 600, retryAfterSeconds: 60 }`
- `account.signup` without `verificationCode` → `code: 'verification-code-required'`
- `account.signup` with wrong `verificationCode` → `code: 'email-code-wrong', attempts remaining: 4`
- `account.wallet.get({ userId })` → `{ userId, balanceMicros: 0, updatedAt: 0 }`
- `artifact.list({ workspaceId })` → `{ items: [] }`
- `host.describe({})` → full host descriptor (loopback trusted)

The full method surface is reachable end-to-end from a real HTTP client; the api-proxy schemas reject malformed envelopes at the wire boundary with structured Zod errors. Future PRs add the desktop IPC bridge (`apps/desktop/src/main/ipc-handlers.ts` → `workbench:auth:*`), the bearer-token persistence layer (`apps/desktop/src/main/credential-store.ts` v3 → `setToken` in `api-client.ts`), and the renderer SignInCard.

## Alternatives considered

**A single combined bundle that includes both the dsh-base patch and the xiaowei-specific rows in one `cordis.yml`.** Rejected: it duplicates the `dsh-base` rows in the xiaowei release artifact and breaks the layering model every other profile (`headless`, `web`, `ops`) already follows. The bundle-of-bundles pattern is the established convention; the xiaowei bundle contributes only the xiaowei-specific rows.

**Disable the headless bundle entirely from the xiaowei template.** Rejected: `dsh-headless` brings the agent loop, the session runtime, and the LLM consumer that the foreground-task runner and the api-proxy's session-bound methods both depend on. Disabling the whole bundle means the HTTP carrier would still bind but every privileged method that calls into `ctx.agents` would fail. The targeted `disabled: true` on `headless-startup` + `headless-runner` removes exactly the one-shot glue.

**Use schemastery `z.literal` in `email-verification` `Config` for the `transportKind` field.** Rejected: the project's `vendor/schemastery` fork does not expose `z.literal`; the inline `z.union(['logging', 'smtp'])` is the form every other config in the seam uses. The bug was in the YAML, not the schema.
