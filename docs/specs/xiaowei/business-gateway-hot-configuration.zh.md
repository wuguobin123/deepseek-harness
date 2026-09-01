---
sdd:
  id: integration.xiaowei.business-gateway-hot-configuration
  kind: integration
  status: implemented
  owners:
    - xiaowei-platform
  requirements:
    - id: REQ-xiaowei-business-gateway-hot-configuration-001
      text: Xiaowei dispatches account business Skill operations through one stable HTTPS Connector while an independently managed Gateway owns business authorization and data access, so publishing an ordinary supported read operation never replaces or restarts the Xiaowei Host process.
    - id: REQ-xiaowei-business-gateway-hot-configuration-002
      text: Gateway configuration selects only registered providers and actions, explicit metric paths and permissions, and hashed grants; the separately validated Skill manifest owns model-facing schemas, and neither configuration can contain executable code, SQL, arbitrary headers, credential values, userId, or tenantId.
    - id: REQ-xiaowei-business-gateway-hot-configuration-003
      text: The Gateway authenticates the deployment-owned service bearer, rejects tenant identity, validates the Host-derived user against the identity source, and checks a dynamically loaded user grant before every query.
    - id: REQ-xiaowei-business-gateway-hot-configuration-004
      text: A complete valid configuration atomically replaces the active immutable snapshot and becomes visible to the next request without restarting either service, while invalid configuration retains the last-good snapshot.
    - id: REQ-xiaowei-business-gateway-hot-configuration-005
      text: Every permitted or denied call records a bounded secret-free durable audit entry, and audit failure prevents a business result from being returned.
    - id: REQ-xiaowei-business-gateway-hot-configuration-006
      text: Production cutover and rollback change only the internal nginx upstream and preserve Xiaowei account, Session, Skill, Gateway configuration, and audit data.
  acceptance:
    - id: ACC-xiaowei-business-gateway-hot-configuration-001
      text: Focused checks reject unregistered providers and actions, unsupported or reserved configuration fields, unsafe owner scope, duplicate paths, database paths outside the startup root, bad credentials, tenant headers, unknown users, permission mismatch, ungranted users, request input, and unavailable audit storage.
      evidence:
        - packages/business/gateway/tests/gateway.spec.ts
    - id: ACC-xiaowei-business-gateway-hot-configuration-002
      text: An assembled Gateway serves the two existing metrics, hot-loads a third configured owner-scoped metric and its grant without process replacement, and retains the previous operations after an invalid update.
      evidence:
        - packages/business/gateway/tests/gateway.spec.ts
        - docs/ops/xiaowei-business-gateway-acceptance.md
    - id: ACC-xiaowei-business-gateway-hot-configuration-003
      text: Production probes and an installed Xiaowei client use the independent Gateway before and after a hot Skill revision, while the recorded Xiaowei PID and service start time remain unchanged across deployment and nginx reload.
      evidence:
        - docs/ops/xiaowei-business-gateway-acceptance.md
        - packages/business/gateway/deploy/installed-client-qa.mjs
  evidence:
    - packages/business/gateway/src/index.ts
    - packages/business/gateway/tests/gateway.spec.ts
    - packages/business/gateway/deploy/dsh-business-gateway.service
    - docs/ops/xiaowei-business-gateway-acceptance.md
  decisions:
    - .agents/notes/implemented/architecture/2026-09-01-independent-business-gateway.md
    - .agents/notes/implemented/architecture/2026-09-01-declarative-business-skill-runtime.md
  identity:
    tenant_scope: authenticated account owner; tenant selection remains unsupported
  credentials:
    provider: deployment-owned service bearer resolved by Xiaowei and supplied to the loopback-only Gateway through internal TLS
  operations:
    - id: operation.xiaowei.business-metric.read
      mode: read
      risk: R1
      approval: none
      idempotency: safe
      retry: bounded
      compensation: none
      audit: required
---
# 小薇 Business Gateway 热配置

[English](business-gateway-hot-configuration.md) | 中文

独立 Gateway 是账号业务 Skill 的执行与授权服务。小薇保留一个稳定的模型可见分发工具和 HTTPS Connector；Gateway 以下的配置只能选择经评审的只读 provider 与逻辑 action。

## 身份与凭据

小薇 Host 从认证 Session 派生账号，并且只通过可信 Connector header 发送该身份。Gateway 不接受请求输入或配置中的身份选择字段，拒绝任何租户 header，也不会收到小薇登录 token。部署方拥有的服务 Bearer 独立于用户授权，用于认证服务连接。

## 热配置

Gateway 把完整配置解析并校验为一个 snapshot 后才发布。每个请求固定使用一个 snapshot；有效的原子文件替换在下一请求生效，无效替换则保留上一正常 snapshot。首个 provider 只暴露经评审的小薇身份逻辑资源聚合 action，因此配置不会变成通用 SQL 或网络执行通道。

## 生产生命周期

Gateway 只监听回环地址，nginx 继续为已批准的 `business.xiaowei.internal` 连接终止 TLS。切流与回滚只替换 nginx upstream 并 reload nginx，两者都不会改变小薇进程或活动 Session。

## 验证

确定性检查覆盖配置、认证、授权、查询绑定、热替换、保留上一正常版本、输出限制和失败关闭审计。生产验收另行证明独立进程、nginx 切流、既有指标、新配置指标、Skill revision 发布、安装态客户端问答，以及小薇 PID 与启动时间保持不变。
