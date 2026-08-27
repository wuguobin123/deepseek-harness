# @deepseek-ai/dsh-llm-account-platform

[English](README.md) | 中文

Xiaowei 的账户模型消费者。配置的 route 只接受账户所属 session，解析或幂等创建用户模型凭据，在真实 provider 调用前预留保守钱包金额，并在终端 stream chunk 前结算实际用量。凭据只通过进程内 `WeakMap` 交给 `llm-pi-ai`，不会进入模型可见参数或 session 事件。

`missingUsagePolicy` 控制 provider 未返回 usage 时的行为：`cancel` 释放预留，`reserve` 按完整保守预估结算。每次 provider attempt 都有独立 reservation；其他 route 完全旁路。

`providerCacheReadReserveTokens` 为请求 JSON 中不可见的供应商自有缓存前缀增加保守预留。默认值可避免上游在短请求中报告缓存读取后，实际金额超过钱包 reservation。

同一插件还注册固定的 `xiaowei-custom` BYOK 路由。自定义选择使用不透明的自定义模型 ID；执行时按 `sessionId → ownerId → resolveCustom()` 解析所属记录，并使用已保存的协议、公网 HTTPS API 地址、上游模型 ID 与解密密钥构造单次 pi-ai profile。该路由不会回退到环境凭据，也不经过钱包。每次调用前都会解析端点主机名，并拒绝私网、回环、链路本地、元数据地址及非公网字面地址；`customModelAllowedHosts` 可把调用进一步限制在部署配置的精确白名单中。

## 模型体验

无。凭据解析、钱包计费和端点策略都位于已组装模型请求之外。

#### KV Cache 影响

无。所选 provider 接收相同的已组装请求前缀。

## 已知限制与后续工作

- **必须具有账号归属。** 已配置的账号路由会拒绝匿名或无 owner 的 Session，不会降级到部署凭据。
- **自定义端点必须是公网 HTTPS Host。** 私网、回环、链路本地、元数据地址与非公网字面地址均不受支持。
