# Agent Note: Xiaowei 账户 MiniMax 额度

Status: implemented

[English](2026-08-24-xiaowei-account-minimax-credit.md) | 中文

## 问题

Xiaowei 注册流程会向本地钱包发放 20 元并保存一个随机内部 `sk_` 值，但没有 LLM 适配器消费该值，模型调用仍然依赖部署级 DeepSeek 凭据。因此，可见的注册结果并没有创建可用的账户模型路由。钱包写入也与模型执行分离，并发请求可能超过显示余额；账户 RPC 的 payload 还能指定其他用户的钱包或凭据行。

参考 Workbench 并不签发 MiniMax 官方 API Key。它创建用户专属 New-API Token，将其加密保存在应用数据库中，只发送给配置的 OpenAI 兼容网关，并以本地微元钱包作为账户额度账本。把该 Token 直接发送到 `api.minimaxi.com` 不仅无效，还会绕过应用的 20 元限制。

## 决策

`dsh-account-model-keys` 按用户和路由确保一枚上游 New-API Token。Provider 登录配置的 New-API 管理地址，通过确定性的精确名称复用 Token，创建或取回 Token，并仅以 AES-256-GCM 密文保存 bearer。账户 RPC 只返回元数据。`resolveActive()` 是进程内模型消费者操作，会记录最后使用时间，且不记录 Token 日志。管理面地址和数据面地址保持为独立配置。

`dsh-llm-account-platform` 拥有 `xiaowei-minimax/MiniMax-M3` 请求路径。它从持久会话 owner 派生用户，确保用户凭据，在调用 provider 前预留保守金额，通过进程内 `WeakMap` 把 Token 交给 `dsh-llm-pi-ai`，并在输出终端 stream chunk 前按报告的 usage 结算。钱包使用持久 SQLite 预留，拒绝超额消费，并在结算时退回未使用预留。Provider 未返回 usage 时默认按完整预留结算；部署可以显式选择取消。

注册会一次性发放 `20_000_000` 微元并尝试创建 Token。登录会幂等重复这两项操作，因此在该路由启用前创建或管理面临时故障期间创建的账户，无需注销或重新注册即可修复。首次模型请求也会执行幂等凭据修复。New-API 故障期间仍可登录，但账户模型路由在凭据创建成功前会按安全侧失败。

远程账户主体只能读取自己的钱包、账本和凭据元数据。钱包变更、凭据创建或撤销、全局模型发现、settings 和全局 credentials 仍是本地管理操作。Host 从已认证 principal 派生账户读取所有者，不再信任 payload 中的 `userId`。

Xiaowei bundle 声明 New-API 管理账户、网关数据地址、MiniMax 模型、Token 策略、价格、预留策略和 20 元欢迎额度。`MiniMax-M3` 的单次请求输出上限默认为 32,768 Token，部署可通过 `XIAOWEI_MODEL_MAX_OUTPUT_TOKENS` 覆盖；该额度让生成产物的工具调用完整结束，避免丢弃被截断的调用。网关地址不提供 MiniMax 官方地址默认值，因为 New-API 用户 Token 不能发送到 MiniMax 官方端点。

缺失管理凭据、网关地址或加密密钥时，插件会在加载配置时失败，不会启动一个只能注册不可用账户的服务。

## 持久化与失败行为

钱包数据库保存 active、settled、cancelled、expired 预留以及结算幂等键。模型凭据数据库保存上游 Token ID、路由、网关地址、模型、价格、撤销状态和加密 bearer。两个数据库都使用单调递增的预发布 schema 版本，遇到不兼容版本时拒绝启动，不猜测迁移。

凭据创建在单进程内串行执行，并由 active 用户路由唯一索引保护。瞬时管理面响应会重试，非瞬时 4xx 会立即失败。撤销操作先隐藏本地凭据，再请求上游；上游失败会被记录，供后续重试。钱包预留失败发生在模型分发前，因此余额不足不会产生 provider 流量。

## 测试

聚焦测试覆盖 New-API 登录、查询、创建、直接返回 Key 与二次取 Key、静态加密、并发 ensure、重试分类、内部解析和撤销。钱包测试覆盖预留和结算状态、幂等、并发与余额不足。账户模型路由测试证明先预留后分发、进程内 Key 交接、终端 chunk 前 usage 结算、缺失 usage 策略、首次使用修复、非平台路由旁路和缺失 owner 拒绝。组装后的 Xiaowei profile 测试固定 32,768 Token 模型默认值。Host 与连接层测试证明账户所有权派生、管理操作拒绝以及真实 loopback 放行。Xiaowei sanity 探针使用确定性 New-API transport，让生产模型凭据 Provider 运行于真实磁盘 SQLite 数据库。

## 生产发布

2026-08-24 发布将 `119.45.252.25:18080` 上的生产 Xiaowei 服务配置为参考部署的 New-API 控制面和兼容模型数据面，并沿用已验证的 32 字节主密钥。发布策略仅一次性发放 `20_000_000` 微元，禁用每日补贴，输入与输出价格分别为每 Token 1 和 8 微元，且只路由 `xiaowei-minimax/MiniMax-M3`。密钥在服务器内复制和验证，没有输出。

预发布的 wallet v1 和 model-key v1 数据库被移入 `/var/lib/dsh-xiaowei/pre-platform-credit-20260824T150104Z`，identity 数据库保留。运行中的服务创建了 wallet schema 2 和 model-key schema 3，现有身份会在登录或首次模型调用时修复欢迎余额和凭据。代码可从 `/opt/dsh-xiaowei.bak-20260824T145909Z` 回滚，旧环境文件可从 `/etc/dsh-xiaowei/server.env.bak-20260824T145516Z` 恢复。

生产验收发现了确定性测试未覆盖的两个情况：New-API 创建 Token 成功后会返回 `data: null`，而生产 session ID 会使钱包操作键超过 64 字符限制。Token 创建现在会把 null data 作为空确认处理，再按精确名称解析已创建的 Token；account-platform 使用固定长度 UUID 操作键。两种情况都已加入回归测试。

新的生产注册账号精确获得 `20_000_000` 微元，保存一枚账户 Token，再次登录后仍为一枚 Token。真实账户所有的 `MiniMax-M3` 轮次使用 7,262 个输入 Token、59 个输出 Token 和 156 个缓存读取 Token 完成；钱包结算 8,685 微元，凭据记录了最后使用时间。最终探针确认 wallet schema 2、model-key schema 3、已结算 `model-usage` 账本、加密 blob 中无明文 `sk-` 前缀、公网与 loopback 健康检查均为 200、重启后无错误，且自动重启数为零。

生产路由使用 32,768 Token 输出上限。一项续跑的产物任务在首次请求中使用 17,861 个输出 Token，完成 `html_build` 并保存 51,213 字节 HTML 产物；随后两个步骤更新任务状态、返回最终答复，轮次以 `completed` 结束。在部署覆盖值变更前，同一任务曾多次在输出量精确达到 8,192 Token 时以 `max-tokens` 结束。环境文件备份位于 `/etc/dsh-xiaowei/server.env.bak-token-cap-20260826T005115Z`。

## 备选方案

**把上游 Token 作为用户的 20 元 Key 暴露。** Token 的上游配额不是 Xiaowei 钱包；暴露后用户可绕过预留，在应用外消费。Token 保持为服务端凭据。

**使用一个部署级 MiniMax 凭据。** 共享 bearer 无法表达账户所有权、按用户撤销或凭据审计，泄漏影响范围也更大。每个账户使用独立上游 Token。

**只在模型响应后扣款。** 并发请求可能同时通过同一次调用前余额检查并造成超额消费。持久预留再结算，使网络请求前的可用余额具有权威性。

**要求用户注销并重新注册。** 注册不是安全的修复机制，还会丢失身份状态。幂等登录和首次使用修复会保留现有账户。

**对每个达到 Token 上限的响应自动重试。** 受 Token 限制的工具调用会被有意丢弃，因为参数可能不完整。在不提高单次请求额度的情况下重试相同 prompt，可能无限复现同一个超大调用；因此路由提供足够的请求额度，并对真正溢出的情况保留 `max-tokens` 终止原因。

## 影响

Xiaowei 初次创建凭据依赖可达的 New-API 管理面，模型调用依赖配置正确的兼容网关。运维人员必须保护管理密码和 `XIAOWEI_MASTER_KEY`，备份两个 SQLite 数据库，并设置与网关账单一致的价格。本地钱包而非 New-API Token 配额，仍是面向用户的 20 元权威额度。更大的默认输出额度会增加调用前的保守钱包预留，结算仍会退回未使用的输出额度。

模型凭据暂不可创建时，身份认证仍可成功。这会保留账户访问，但管理面恢复前，首次模型请求仍可能报告凭据创建错误；下一次登录或模型调用会安全重试。生产发布将旧数据库作为迁移产物保留，而不是解释不兼容的预发布数据行。
