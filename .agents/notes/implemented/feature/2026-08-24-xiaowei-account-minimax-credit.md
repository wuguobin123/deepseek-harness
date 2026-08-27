# Agent Note: Xiaowei account MiniMax credit

Status: implemented

English | [中文](2026-08-24-xiaowei-account-minimax-credit.zh.md)

## Problem

Xiaowei registration credited a local wallet with 20 CNY and stored a random internal `sk_` value, but no LLM adapter consumed that value and model calls still required a deployment-wide DeepSeek credential. The visible onboarding result therefore did not create a usable account model route. Wallet writes also happened outside model execution, so concurrent calls could spend beyond the displayed balance, and account RPC payloads could name another user's wallet or credential rows.

The reference Workbench does not issue an official MiniMax API key. It creates a per-user New-API token, encrypts it in the application database, sends it only to the configured OpenAI-compatible gateway, and treats the local micro-CNY wallet as the account credit ledger. Sending that token directly to `api.minimaxi.com` is invalid and would also bypass the application's 20 CNY limit.

## Decision

`dsh-account-model-keys` ensures one upstream New-API token per user and route. The provider authenticates to the configured New-API management URL, reuses an exact deterministic token name, creates or retrieves the token, and stores its bearer value only as AES-256-GCM ciphertext. Account RPCs return metadata only. `resolveActive()` is the in-process model-consumer operation, records last use, and never logs the token. Management and data-plane URLs remain separate configuration values.

`dsh-llm-account-platform` owns the `xiaowei-minimax/MiniMax-M3` request path. It derives the user from the durable session owner, ensures the user's credential, reserves a conservative amount before calling the provider, hands the token to `dsh-llm-pi-ai` through a process-local `WeakMap`, and settles reported usage before yielding the terminal stream chunk. The wallet uses durable SQLite reservations, rejects overspending, and refunds unused holds during settlement. A response without usage settles the full reservation by default; deployments may explicitly choose cancellation.

Registration grants `20_000_000` micros once and attempts token provisioning. Sign-in repeats both operations idempotently, so accounts created before this route or during a temporary management-plane outage repair without deletion or re-registration. A first model request also performs an idempotent credential repair. Authentication remains available during a New-API outage, while the account model route fails closed until provisioning succeeds.

Remote account principals can read only their own wallet, ledger, and credential metadata. Wallet mutation, credential provisioning or revocation, global model discovery, settings, and global credentials remain local-management operations. The host derives account read ownership from the authenticated principal instead of trusting a payload `userId`.

The Xiaowei bundle declares the New-API management account, gateway data URL, MiniMax model, token policy, prices, reservation policy, and 20 CNY welcome credit. `MiniMax-M3` receives a 32,768-token per-request output cap by default, with `XIAOWEI_MODEL_MAX_OUTPUT_TOKENS` as the deployment override; this leaves artifact-producing tool calls enough room to finish instead of discarding a truncated call. The gateway URL has no official MiniMax default because a New-API user token must not be sent to the official MiniMax endpoint.

Missing management credentials, gateway addresses, or encryption key fail configuration at plugin load instead of allowing a server that can register unusable accounts.

## Persistence and failure behavior

The wallet database stores active, settled, cancelled, and expired reservations plus settlement idempotency keys. The model-key database stores the upstream token id, route, gateway URL, model, prices, revocation status, and encrypted bearer. Both databases use monotonic pre-release schema versions and reject incompatible versions rather than guessing a migration.

Provisioning is serialized per process and protected by a unique active user-route index. Transient management responses retry; non-transient 4xx responses fail immediately. Revocation hides the local credential before the upstream request and records an upstream failure for a later retry. A wallet reservation failure occurs before model dispatch, so insufficient balance cannot trigger provider traffic.

## Testing

Focused tests cover New-API login, list, create, direct-key and follow-up-key responses, encryption at rest, concurrent ensure, retry classification, internal resolution, and revocation. Wallet tests cover reservation and settlement state, idempotency, concurrency, and insufficient balance. Account-platform tests prove reserve-before-dispatch, process-local key handoff, usage settlement before finish, missing-usage policy, first-use repair, non-platform pass-through, and missing-owner rejection. The assembled Xiaowei profile test pins the 32,768-token model default. Host and connection tests prove account ownership derivation, management denial, and real loopback access. The Xiaowei sanity probe runs the production model-key provider against an on-disk SQLite database with a deterministic New-API transport.

## Production rollout

The 2026-08-24 rollout configured the production Xiaowei service on `119.45.252.25:18080` with the reference deployment's New-API control plane and compatible model data plane, while retaining its existing validated 32-byte master key. The deployed policy grants `20_000_000` micros once, disables daily refresh, prices input and output at 1 and 8 micros per token, and routes only `xiaowei-minimax/MiniMax-M3`. Secrets were copied and validated on the server without being printed.

The pre-release wallet v1 and model-key v1 databases were moved to `/var/lib/dsh-xiaowei/pre-platform-credit-20260824T150104Z`; the identity database was retained. The running service created wallet schema 2 and model-key schema 3, so existing identities repair their welcome balance and credential on sign-in or first model use. The code rollout is recoverable from `/opt/dsh-xiaowei.bak-20260824T145909Z`, and the prior environment file is recoverable from `/etc/dsh-xiaowei/server.env.bak-20260824T145516Z`.

Production acceptance exposed two cases the deterministic tests had not represented: New-API returns `data: null` after a successful token create, and production session ids made wallet operation keys exceed the 64-character limit. Token creation now treats null data as an empty acknowledgement and resolves the created token by exact name; account-platform uses fixed-length UUID operation keys. Regression tests cover both cases.

A fresh production signup received exactly `20_000_000` micros, stored one account token, and retained one token after a second sign-in. A real account-owned `MiniMax-M3` turn completed with 7,262 input tokens, 59 output tokens, and 156 cache-read tokens; the wallet settled 8,685 micros and the credential recorded last use. The final probes found wallet schema 2, model-key schema 3, settled `model-usage` rows, no plaintext `sk-` prefix in encrypted blobs, public and loopback health responses at 200, no post-restart errors, and zero automatic restarts.

The production route uses a 32,768-token output cap. A resumed artifact task consumed 17,861 output tokens in its first request, completed `html_build`, and stored a 51,213-byte HTML artifact; two following steps updated the task state and returned the final answer, and the turn ended `completed`. The same task had repeatedly ended `max-tokens` at exactly 8,192 output tokens before the deployment override changed. The environment file backup is `/etc/dsh-xiaowei/server.env.bak-token-cap-20260826T005115Z`.

## Alternatives considered

**Expose the upstream token as the user's 20 CNY key.** The token's upstream quota is not the Xiaowei wallet, and exposing it would let a user bypass reservations and spend outside the application. The token remains a service-side credential.

**Use one deployment-wide MiniMax credential.** A shared bearer cannot express account ownership, per-user revocation, or credential audit and creates a larger leakage scope. Each account receives a distinct upstream token.

**Debit only after the model response.** Concurrent requests could all pass the same pre-call balance check and overspend. Durable reservation followed by settlement keeps available balance authoritative before network traffic.

**Require users to delete and recreate accounts.** Registration is not a safe repair mechanism and would discard identity state. Idempotent sign-in and first-use repair preserve existing accounts.

**Automatically retry every max-token finish.** A token-limited tool call is deliberately discarded because its arguments may be incomplete. Retrying the same prompt without increasing the per-request budget can reproduce the same oversized call indefinitely, so the route provides enough request budget and preserves `max-tokens` as a visible terminal reason for genuine overflows.

## Consequences

Xiaowei now depends on a reachable New-API management plane for initial credential creation and on a configured compatible gateway for model calls. Operators must protect the management password and `XIAOWEI_MASTER_KEY`, back up both SQLite databases, and set prices that match gateway billing. The local wallet, not the New-API token quota, remains the user-visible 20 CNY authority. The larger default output cap increases the conservative pre-call wallet hold, while settlement still refunds unused output allowance.

Authentication can succeed while model provisioning is temporarily unavailable. This preserves account access but means the first model request can still report a provisioning error until the management plane recovers; the next sign-in or model attempt retries safely. The production rollout preserves the old databases as migration artifacts rather than interpreting incompatible pre-release rows.
