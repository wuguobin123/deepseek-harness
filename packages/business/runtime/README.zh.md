# Business Skill Runtime

[English](README.md) | 中文

稳定的 `business_skill_call` 调度器从可信上下文派生账户，在 I/O 前检查活动版本、操作、连接器和凭据策略。只有操作显式命名已批准的 `credentialRef` 时才使用部署凭据；运行时不会默认选用清单中的其他引用。HTTPS 连接器把可信用户 ID 与所需权限传给业务 API，由业务 API 执行权威的业务权限校验。

## 模型体验

### 稳定分发工具

#### 模型看到的内容

稳定的 `business_skill_call` schema、选中的账户 Skill 指引与经过校验的有界业务结果。身份、租户、凭据、授权 header 和审计元数据保持隐藏。

#### Token 影响

一个稳定工具 schema，加上取决于数据的选中 Skill 指引和成功结果 JSON。

#### KV Cache 影响

稳定工具 schema 保持可缓存；后续活动版本变更只能替换选中的 Skill 指引与结果后缀。

## 已知限制与后续工作

- 输入与输出 schema 使用仓库强制执行的 JSON Schema 子集；转换逻辑和该子集之外的 schema 关键字需要经过评审的连接器或运行时扩展。
