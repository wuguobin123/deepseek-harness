# Agent Note: 独立业务 Gateway

Status: implemented

[English](2026-09-01-independent-business-gateway.md) | 中文

## Problem

声明式业务 Skill 运行时可以热加载账号拥有的操作 manifest，但首个小薇指标端点及其用户授权曾运行在小薇 Host 内。新增数据库查询或授权仍会改变 Host 代码或启动配置；即使模型可见工具与 Connector 协议保持稳定，普通业务演进也会被绑定到智能体服务替换。

## Decision

业务授权与数据访问运行在既有内部 TLS 主机名后的回环地址 Gateway 中。小薇继续从认证 Session 派生用户、解析部署方拥有的服务凭据，并调用一个已批准的 HTTPS Connector。只有 nginx 选择 Gateway upstream，因此切流与回滚都不会替换小薇。

Gateway 原子热加载部署方拥有的配置，其中包含操作 id、路径、已注册 provider/action 名称、权限和使用 subject hash 的授权。Skill manifest 单独管理模型可见的 JSON schema。两类配置都不包含可执行代码、SQL、任意 header、凭据值、`userId` 或 `tenantId`。首个 provider 把已注册身份聚合 action 映射到只读数据库句柄上的固定参数化查询。新增 provider 或 action 实现需要部署 Gateway，但不需要部署小薇。

每次请求固定使用一个已经校验的配置 snapshot，以恒定时间认证服务 Bearer，拒绝租户身份，校验 Host 派生用户，检查精确操作权限和动态授权，执行已注册 action，限制响应大小，并在返回结果前持久审计。无效配置保留上一正常 snapshot。

## Alternatives considered

**继续向小薇 webserver 增加路由。** 这能保持首个实现较小，但每项新查询或授权来源都要求重启小薇，不符合独立业务生命周期。

**允许 Skill manifest 包含 SQL 或可执行代码。** 这会把靠近模型的账号配置变成数据库执行通道，使发布者能够绕过 provider 评审、身份派生和响应限制。

**把小薇登录 token 提供给 Gateway。** 该 token 的 audience 不正确，并会提供可复用的账号权限。Gateway 改为认证服务连接，并对单独提供的可信用户授权。

## Verification

9 个基于真实临时 HTTP 和 SQLite 实例的聚焦测试证明了已注册 action 选择、保留配置拒绝、安全所有者隔离、路径与数据库根目录约束、服务与用户授权、请求输入拒绝、同进程热替换、保留上一正常版本、仅所有者可读且不含秘密的审计，以及审计失败关闭。生产环境提供了两个迁移指标，热新增 `share-code-unused`，发布业务 Skill revision 3，并通过安装态客户端的 `business_skill_call` 完成问答。小薇 PID 与启动时间保持不变，Gateway PID 在配置更新前后也保持不变。详细证据见[生产验收记录](../../../../docs/ops/xiaowei-business-gateway-acceptance.zh.md)。

## Consequences

普通已注册只读 action 和授权现在可以在不修改或重启小薇的情况下变化。Gateway 同时成为独立可用性依赖，因此 nginx 保留旧 upstream 作为明确回滚目标，systemd 管理新进程。封闭 provider/action 目录把纯配置工作限定为经过评审的查询族；复杂计算、新数据系统、写操作和新授权模型需要 Gateway 代码及独立验收。
