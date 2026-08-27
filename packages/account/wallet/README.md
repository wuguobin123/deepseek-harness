# @deepseek-ai/dsh-account-wallet

English | [中文](README.zh.md)

Xiaowei multi-user wallet service: amounts use micros (1,000,000 micros = 1.00 CNY), balances and ledger entries persist in SQLite, and `ctx.wallet` exposes the service.

## On-disk format and reservations

Schema version 2 rejects older pre-release databases. Alongside `wallets` and `wallet_ledger`, `wallet_reservations` persists model-call holds. `reserve` clears expired holds and checks available balance in `BEGIN IMMEDIATE`; `settle` closes the hold atomically and writes one `model-usage` ledger row for actual usage no greater than the reservation; `cancel` releases the hold without a ledger row. Successful repeats are idempotent, cancelled settlements and settled cancellations return stable errors, and active holds survive process restart.

`reservationTtlSeconds` is configurable, defaults to 3,600 seconds, and has a minimum of 1. Repeated settlement must carry the original actual amount and idempotency key. Parameter drift or a key already used by another ledger operation returns `RESERVATION_CONFLICT` atomically. Service entry points validate all monetary values as safe integers and all operation identifiers as 1..64-character strings.

## Service methods

In addition to `get`, `credit`, `debit`, `setQuota`, `refreshDaily`, `grantWelcomeBonus`, and `listLedger`, the service provides:

- `reserve({ userId, reservationId, amountMicros })`
- `settle({ userId, reservationId, actualMicros, idempotencyKey })`
- `cancel({ userId, reservationId })`

Account reads derive `userId` from the authenticated principal, so a payload cannot select another account. Credit, debit, quota, refresh, welcome-credit, and credential management reject remote account principals.

After registration, the host idempotently grants the 20 CNY welcome credit and ensures a per-user New-API token. Sign-in and the first account model call repair both operations idempotently, so account deletion or re-registration is unnecessary. `dsh-llm-account-platform` reserves before gateway dispatch and settles actual usage before the terminal stream chunk; BYOK routes do not use this balance.

## Model Experience

None, as wallet reservation and settlement run outside model context and expose no prompt or tool definition.

#### KV Cache effect

None. Balance and ledger values never enter a model request.

## Known Limitations and Deferred Work

- **One currency and pricing unit.** Balances use CNY micros; currency conversion is not implemented.
- **Reservation settlement depends on provider usage.** The account-platform policy must choose cancellation or full-reserve settlement when usage is absent.
