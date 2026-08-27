# Agent Note：远程设置中的账户自定义模型

状态：已实施

[English](2026-08-25-account-custom-models.md) | 中文

## 问题

回环 Models 编辑器写入 Host 全局设置和凭据；如果直接向已认证的远程 Xiaowei 客户端开放，一个账户就能修改所有账户的提供方配置。远程用户仍需在设置页添加自己的 OpenAI 兼容端点与密钥，在对话模型选择器中看到该模型，并在不泄露密钥或跨越账户所有权的情况下使用它。

## 决策

**自定义模型是不可变的账户记录，而不是 Host 提供方 profile。** `user_custom_models` 保存不透明 ID、owner、显示名称、协议、规范化后的公网 HTTPS API 地址、上游模型 ID、AES-256-GCM 加密密钥、创建时间和可选撤销时间。`account.customModels.create/list/remove` 从已认证 principal 派生 owner，从不接受用户 ID；列表和变更响应只包含元数据。预发布 SQLite schema 升至版本 4，并拒绝旧文件，不做隐式迁移。

**运行时路由固定，选择值使用不透明 ID。** `xiaowei-custom` 是唯一协议路由，其外层模型 ID 是自定义记录 ID。`session.models` 仅列出该 Session owner 所属的有效记录；`session.selectModel` 校验相同的 owner 与有效状态，不把选择持久化为 Host 全局默认；`session.prompt` 在接收工作前再次校验。调用时再按 `sessionId → ownerId → resolveCustom()` 解析记录，用已保存的端点、协议、上游模型和密钥构造单次 pi-ai profile，并且不会回退到环境凭据或进入钱包路径。

**远程设置使用独立的账户页面。** 回环连接保留现有 Host 编辑器与 DeepSeek 引导。远程连接注册 `AccountModelsSection`，只调用账户自定义模型 RPC，使用只写 password 输入框，创建成功或取消时清空密钥，并在删除前确认。客户端会先将 create 密钥脱敏，再把出站信封交给诊断观察者；未修改的真实请求仍发送到已认证载体。

**自定义端点仅允许公网 HTTPS。** 创建时拒绝 URL 中的凭据、fragment 以及明显的回环和私网字面地址。每次调用都会重新解析主机名，并拒绝私网、回环、链路本地、元数据、保留及非公网地址；部署还可用 `customModelAllowedHosts` 进一步限制精确主机名。私网模型需要单独的部署策略，不属于本能力范围。

## 结果

存储测试覆盖密文字节、重启后解密、仅元数据列表、所有权、撤销、配额与非法输入。API 测试覆盖认证 principal 派生与本地 principal 拒绝。Session 测试覆盖 owner 过滤目录、选择拒绝、不写全局默认以及撤销后的 prompt 拒绝。运行时测试证明已保存的端点、模型与密钥进入自定义请求且不预留钱包金额；远程组件测试覆盖创建、密钥清空和确认删除。

## 考虑过的替代方案

- **远程开放 `settings.*`、`credentials.*` 与 `llm.*`**——拒绝，因为这些方法修改部署级 Host 状态，并且按设计只允许回环访问。
- **为每个账户模型创建一条 provider route**——拒绝，因为 LLM 注册表是 Host 全局状态，账户 ID 或机密会进入共享拓扑和路由名。
- **直接把上游模型 ID 保存为 Session 选择值**——拒绝，因为不同账户可以用相同 ID 指向不同端点与密钥；不透明记录 ID 让每次读取都以所有权为准。
- **默认允许私网端点**——拒绝，因为远程提供的 API 地址会成为进入部署内网的 SSRF 路径。
