# Agent Note: Xiaowei console exporter for dev/CI log capture

Status: implemented

English | [中文](2026-08-24-xiaowei-dev-logger.zh.md)

## Problem

The xiaowei multi-user bundle ships `LoggingEmailSender` (the dev / CI fallback when SMTP is not configured). On `account.emailCode`, it calls `this.logger.warn('email-verification: code sent email=%s code=%s expiresInSeconds=%d', ...)` — the raw 6-digit verification code in the message body. The desktop client drives a real signup flow: the user fills the email + password + verification-code fields and the IPC bridge calls `account.emailCode` → `account.signup`. The catch is that Cordis's `LoggerService` only ships an in-memory buffer exporter; without an explicit `ctx.logger.exporter({ ... })` registration, every `ctx.logger.*` call is silently dropped. The verification code is written to /dev/null, the user has no way to retrieve it, and the only fallback is brute-forcing the PBKDF2-HMAC-SHA256(200K iterations) hash in `email-verification.sqlite` (salt 16 B, hash 32 B, search space 10⁶) — a 5-10 hour calculation on a single core.

The cleanest fix without modifying vendored Cordis (`vendor/cordis/src/logger.ts`) or patching `LoggingEmailSender` in `packages/account/email-verification/src/sender.ts` is a third Cordis plugin that registers a console exporter on the existing `LoggerService`. The exporter is per-fiber state on the service's `exporters` map; once registered, every future `ctx.logger.warn/info/error` call iterates the map and emits through the new exporter.

## Decision

Add a tiny function plugin `xiaowei-dev-logger` (`packages/bundle/xiaowei/src/dev-logger.ts`) and register it in `cordis.patch.yml` between `xiaowei-startup` and `xiaowei-runner`. The plugin's `apply(ctx)` calls:

```ts ignore-check
ctx.logger.exporter({
  colors: false,
  levels: { default: 3 }, // LoggerLevel.DEBUG = 3 — emit every severity
  maxLength: 8192,
  export(message) {
    process.stderr.write(`[${ts}] [${type}] ${name}: ${formatted}\n`)
  },
})
```

`levels.default` is the *minimum* severity the exporter accepts — Cordis's filter is `if (targetLevel < level) continue`. Setting it to `LoggerLevel.DEBUG (3)` lets every severity pass. Setting it to `0` (the obvious "lowest level") would skip INFO and WARN, swallowing the verification code. The first iteration set `default: 0` and the exporter was registered but never fired — the bug was only visible because the dev / CI flow needs the actual code in the log, not just a registered exporter.

The exporter formats each record through `Logger.format(exporter, message)` and writes one line to `process.stderr`. `stderr` rather than `stdout` because stdout is reserved for `dsh-xiaowei`'s structured CLI output (the one-shot task path) and systemd / launchd journal routing prefers stderr for log records. The bundling `no-cd; nohup` redirect (`>log 2>&1`) folds both into one file.

The plugin is gated by `XIAOWEI_CONSOLE_LOGGER` (default `true` for now). When the bundle ships a real SMTP transport to production, an operator can set the env to `false` and revert to the silent in-memory buffer. The gate is documented in the JSDoc and the constant lives next to the `apply()` body so the toggle is one search away.

The package's `package.json` adds `./dev-logger` to the `exports` map (mirroring `./startup` and `./invariant`). The cordis patch row references the new export. The compiled `lib/dev-logger.js` and `lib/dev-logger.d.ts` are emitted by `tsc -p tsconfig.json` and copied to the package root to match the build pattern that `startup.js` already uses (the xiaowei bundle runs both `lib/types/*.js` for type-aware emit and `lib/*.js` for runtime resolution).

## Alternatives considered

**Patch `LoggingEmailSender.sendVerificationCode` to write to stderr directly.** A 1-line edit on top of the existing `this.logger.warn(...)` call would land the code in the log. The seam belongs to `sender.ts` (the package that defines the contract), but every other sender implementation — SmtpEmailSender and any future EmailSender — would also need the same stderr fallback, which is structural noise. The xiaowei bundle is the dev-facing surface; the dev facility belongs there, not in the account seam. The `EmailSender` package also doesn't import Node's `process` module today; pulling in a stdlib reference for a dev-only fallback blurs the contract.

**Register the console exporter in `xiaowei-startup.ts`.** Startup is a 50-line plugin whose single responsibility is parsing CLI args and publishing `XIAOWEI_STARTUP_SERVICE`. Adding a logger registration there mixes lifecycle with observability. A future PR that drops the one-shot task path (xiaowei runs as a long-lived multi-user service) would have to either delete the registration or move it again. Separate plugin keeps each file's purpose searchable.

**Add a `console` logger row to `cordis.patch.yml` with a built-in service that owns the exporter.** Cordis has no built-in console exporter; making one would require either modifying vendored code (`vendor/cordis/src/logger.ts`) or shipping a separate `@deepseek-ai/cordis-plugin-console-logger` package. Either approach makes the console exporter *part of the framework*, which is wrong: it's a xiaowei dev facility, not a Cordis feature. A bundle-local function plugin lives in the right place.

**Use `process.stdout.write` instead of `process.stderr.write`.** Stdout is the conventional CLI surface; the xiaowei runner writes its `runTask` outcome text there. Mixing log records with task output would break any downstream tool that greps stdout for the run-result line. Stderr is the right channel for diagnostics — systemd, launchd, and most log aggregators route stderr by default, while stdout is the API the task contract commits to.

**Set `levels.default` to `LoggerLevel.INFO (1)` and rely on a higher logger default level.** The xiaowei process inherits no logger intercept config, so the logger's own `level` defaults to `INFO`. The filter reads `exporter.levels?.[name] ?? exporter.levels?.default ?? logger.level ?? INFO`. Setting `default: 1` would skip DEBUG; setting `default: 3` (DEBUG) lets every severity pass. The first iteration set `default: 0` thinking "lowest level = emit everything"; Cordis's filter inverted that intuition — `targetLevel < level` means "skip when the exporter accepts a lower severity than this call". Picking `DEBUG` is the only value that emits everything without per-name overrides.

## Consequences

`account.emailCode` for a fresh user now writes the raw 6-digit code to the xiaowei stderr / log file (`/tmp/dsh-xiaowei.log` in this dev flow). The CDP probe (`apps/desktop/desktop-signup-flow.mjs`) tails the log for `code=(\d{6})`, parses the latest match, fills the SignInCard's verification-code field via `window.workbenchApi.signUp`, and confirms `auth-state-after` flips to `signedIn:true` with a non-empty `userId`. The full chain — `requestEmailCode` → log capture → `signUp` → `getAuthState` after — runs in ~1.5 s end-to-end. The post-signup state shows `wallet.get` returning `balanceMicros: 20_000_000` (the 20 CNY welcome bonus) and `host.describe` succeeding with the bearer header injected by `api-client.setToken`. The signin-gate unmounts and the Cordis sidebar shell mounts in its place; the `data-slot="sidebar"` workspace picker renders with the brand row.

The `XIAOWEI_CONSOLE_LOGGER` env defaults to enabled for now. Production deployments that configure `XIAOWEI_SMTP_HOST` should also set `XIAOWEI_CONSOLE_LOGGER=false` so verification codes don't appear in operator logs; this is documented in the JSDoc. A future PR may add per-name level overrides (`levels: { 'email-verification': 0 }` to drop the raw code but keep the audit-trail message) once the audit-trail product surface is decided.

The exporter is per-process — every xiaowei boot registers it freshly, and every xiaowei shutdown disposes it via the standard `ctx.effect()` disposer path. The registration order in `cordis.patch.yml` places it after `xiaowei-startup` (which publishes the bind port + task) and before `xiaowei-runner` (which drives the optional foreground task). Any future plugin that wants to log in its `apply()` can rely on the exporter being live by the time it mounts.

The `vendor/cordis/src/logger.ts` file is untouched — no vendored modification. `LoggingEmailSender` is untouched. The bundle patch row mirrors the existing `xiaowei-startup` row's shape so a future contributor adding a new dev plugin can copy the row as a template.
