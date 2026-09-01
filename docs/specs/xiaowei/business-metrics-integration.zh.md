---
sdd:
  id: integration.xiaowei.business-metrics
  kind: integration
  status: implemented
  owners:
    - xiaowei-platform
  requirements:
    - id: REQ-xiaowei-business-metrics-001
      text: An authorized account can ask for the current registered-account count through a read-only configured operation without exposing account records.
    - id: REQ-xiaowei-business-metrics-002
      text: An authorized account can ask for the number of its consumed invitation codes, with the owner derived from trusted execution context rather than operation input.
    - id: REQ-xiaowei-business-metrics-003
      text: Both operations return bounded count-only results with observation time and record a secret-free audit outcome.
  acceptance:
    - id: ACC-xiaowei-business-metrics-001
      text: A keyless configured-provider check answers the two Chinese questions with exact structured counts and rejects a caller lacking the operation permission.
      evidence:
        - packages/business/connector-http/tests/connector-http.spec.ts
        - packages/business/runtime/tests/runtime.spec.ts
        - packages/business/gateway/tests/gateway.spec.ts
    - id: ACC-xiaowei-business-metrics-002
      text: A real Xiaowei business endpoint smoke verifies authentication, owner scoping, response validation, and audit correlation separately from the simulated-provider evidence.
      evidence:
        - docs/ops/xiaowei-business-metrics-acceptance.zh.md
  evidence:
    - packages/business/connector-http/src/index.ts
    - packages/business/gateway/src/index.ts
    - packages/business/runtime/src/index.ts
    - docs/ops/xiaowei-business-metrics-acceptance.zh.md
  decisions:
    - docs/specs/xiaowei/business-skill-hot-loading.zh.md
    - .agents/notes/implemented/architecture/2026-09-01-declarative-business-skill-runtime.zh.md
  identity:
    tenant_scope: authenticated account owner; tenant selection is unsupported until an authoritative membership service exists
  credentials:
    provider: deployment-owned credential reference resolved per operation
  operations:
    - id: operation.xiaowei.registered-accounts.read
      mode: read
      risk: R1
      approval: none
      idempotency: safe
      retry: bounded
      compensation: none
      audit: required
    - id: operation.xiaowei.share-code-usage.read
      mode: read
      risk: R1
      approval: none
      idempotency: safe
      retry: bounded
      compensation: none
      audit: required
---
# 小薇业务指标集成

[English](business-metrics-integration.md) | 中文

该集成是业务 Skill 运行时的首个配置消费方。它暴露两个只读计数操作：供获准操作员查询的平台注册账号数，以及限定到认证 owner 的已使用邀请码数量。

## 身份

Host 在准入提示词前校验账号 Bearer。业务执行器从 Session header 派生 owner，绝不接受操作输入中的账号或租户选择字段。

## 凭据

连接器在请求前立即解析部署方拥有的凭据引用。定义、模型、客户端响应、工具参数和审计记录都不包含凭据值。

## 操作

两个操作都是 R1 读取，采用有限重试、无需批准、无需补偿、严格输出校验和强制审计。注册账号操作要求平台指标权限；邀请码操作还会把资源 owner 限定为认证账号。

## 验证

聚焦检查在无外部访问时证明路由、授权、重试限制、响应校验和持久化无秘密审计。[生产验收](../../ops/xiaowei-business-metrics-acceptance.zh.md)另行记录内网 TLS 端点探针、热发布和安装态客户端问答。
