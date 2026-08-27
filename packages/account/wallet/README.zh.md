# @deepseek-ai/dsh-account-wallet

[English](README.md) | 中文

Xiaowei 多用户钱包服务：金额单位为 micros（1,000,000 micros = 1.00 CNY），余额和账本持久化在 SQLite，并通过 `ctx.wallet` 提供服务。

## 磁盘格式与预留

schema 版本为 2；旧版本数据库会被拒绝，不做预发布兼容。除 `wallets` 和 `wallet_ledger` 外，`wallet_reservations` 持久化模型调用的余额预留。`reserve` 在 `BEGIN IMMEDIATE` 中清理过期预留并检查可用余额；`settle` 原子关闭预留，只按不超过预留的实际用量写入一条 `model-usage` 账本记录；`cancel` 释放预留且不写账本。重复成功调用安全，已取消的 settle 和已结算的 cancel 返回稳定错误，进程重启后 active 预留仍占用余额。

`reservationTtlSeconds` 可配置，默认 3,600 秒且最小为 1。重复结算必须携带原实际用量和结算幂等键；参数漂移或与其他账本操作冲突的幂等键返回 `RESERVATION_CONFLICT` 并原子拒绝。所有金额和操作 ID 在服务入口校验为安全整数及 1..64 字符字符串。

## 服务方法

除 `get`、`credit`、`debit`、`setQuota`、`refreshDaily`、`grantWelcomeBonus`、`listLedger` 外，服务提供：

- `reserve({ userId, reservationId, amountMicros })`
- `settle({ userId, reservationId, actualMicros, idempotencyKey })`
- `cancel({ userId, reservationId })`

账户读取会从已认证 principal 派生 `userId`，payload 不能改为其他账户。credit、debit、setQuota、refreshDaily、欢迎额度和凭据管理均拒绝远程账户 principal。

注册后，Host 会幂等发放一次 20 元欢迎额度并确保用户专属 New-API Token；登录和首次账户模型调用会再次幂等修复，因此不需要注销或重新注册。`dsh-llm-account-platform` 在触发网关请求前预留余额，并在终端 stream chunk 前按实际 usage 结算；BYOK 路由不使用这笔余额。

## 模型体验

无。钱包预留与结算在模型上下文之外运行，不公开提示词或工具定义。

#### KV Cache 影响

无。余额与账本值绝不进入模型请求。

## 已知限制与后续工作

- **只有一种货币与计价单位。** 余额使用 CNY micros，尚未实现货币转换。
- **预留结算依赖 provider usage。** usage 缺失时，account-platform 策略必须选择取消或按完整预留额结算。
