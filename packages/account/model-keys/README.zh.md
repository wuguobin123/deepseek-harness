# 用户模型密钥

[English](README.md) | 中文

本包按用户和 provider route 幂等确保 New-API Token。管理凭据只在服务端使用；Token 以 AES-256-GCM 加密存入 SQLite，绝不通过 account RPC 返回。`resolveActive()` 是内部模型调用入口，并记录 `last_used_at`。

同一服务还在 `user_custom_models` 中保存账户所属的 OpenAI 兼容自定义模型。`createCustom()` 会校验并规范化名称、公网 HTTPS API 地址、协议、上游模型 ID 与密钥，持久化时只保存加密密钥；`listCustom()` 仅返回不含密钥的元数据，`removeCustom()` 只撤销当前账户所属的有效记录，`resolveCustom()` 仅为进程内模型消费者解密当前账户所属的有效记录。自定义模型 ID 是不透明标识，每个账户的有效记录数由 `maxCustomModels` 限制。

价格单位为每 Token 的 CNY 微元。Token 配额和 unlimited 配置均显式传入 New-API。管理面 URL 与模型数据面 URL 分离。

## 模型体验

无。保存的凭据与路由元数据只在模型适配器内部解析，绝不进入提示词或工具结果。

#### KV Cache 影响

无。凭据选择不会改变已组装的请求前缀。

## 已知限制与后续工作

- **每个部署只有一个 New-API 服务账号。** 每条 route 使用一套已配置的 Token 策略。
- **自定义端点协议有限。** 只支持 `openai-completions` 与 `openai-responses`，并拒绝私网端点。
