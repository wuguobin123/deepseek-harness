# `@deepseek-ai/dsh-business-gateway`

[English](README.md) | 中文

这个独立 Node 进程在回环地址提供经过评审的只读小薇身份指标。它认证部署服务 Bearer、校验 Host 派生用户、检查热加载授权，以只读和 `query_only` 方式打开 `identity.sqlite`，并在返回有界结果前审计调用结果。它不会收到小薇登录 token。

## 配置

进程要求设置 `DSH_BUSINESS_GATEWAY_CONFIG`、`DSH_GATEWAY_DATABASE_ROOT`、`DSH_BUSINESS_GATEWAY_AUDIT`、1 到 65535 范围内的 `DSH_BUSINESS_GATEWAY_PORT`，以及 `XIAOWEI_BUSINESS_API_TOKEN`。数据库与审计路径属于启动策略，不在热配置中。JSON snapshot 只接受 `revision`、`operations` 和使用摘要的 `grants`：

```json
{
  "revision": 2,
  "operations": [
    {
      "id": "share-code-unused",
      "path": "/metrics/share-code-unused",
      "provider": "xiaowei-identity",
      "action": "unconsumed-invitation-count",
      "permission": "metrics.share-codes.available.read",
      "ownerScoped": true
    }
  ],
  "grants": [
    {
      "subjectHash": "<sha256-of-host-derived-user-id>",
      "permissions": ["metrics.share-codes.available.read"]
    }
  ]
}
```

配置不能包含 SQL、任意 URL 或 header、凭据、`userId` 或 `tenantId`。已注册 action 包括 `registered-account-count`、`registered-user-page`、`consumed-invitation-count` 和 `unconsumed-invitation-count`。账号数和注册用户分页为全局查询；分享码 action 始终按所有者隔离。分页 action 需要独立的 `users.details.read` 权限，只返回脱敏邮箱和日期字段；计数响应上限为 512 个 UTF-8 字节，明细响应上限为 4096 个字节，超限返回小型 503 且不写入明细审计。模型可见的输入与输出 JSON schema 仍由 Skill manifest 单独管理。

使用原子操作替换完整文件。下一次请求会使用新的有效 snapshot，不替换 Gateway 或小薇进程；无效文件保留上一正常 snapshot。凭据不可用、Bearer 无效、tenant header、用户缺失或不存在、权限不匹配、未授权、query 或 body 输入、审计不可用及未注册操作都会失败关闭。

## 部署

随附的 `deploy/dsh-business-gateway.service` 监听 `127.0.0.1:18082`。`deploy/seed-config.mjs` 把旧部署授权转换为 subject hash，不会把原始账号 id 写入 Gateway 配置。nginx 继续在 `business.xiaowei.internal` 终止 TLS；切流只把 upstream 从 18000 改为 18082 并 reload nginx。回滚时恢复 18000、reload nginx 并停止 Gateway，不改变账号、Session、Skill、配置或审计数据。

## 模型体验

### 独立业务执行

#### 模型看到什么

本包不直接提供模型可见内容。既有 `business_skill_call` Tool 和账号拥有的 Skill manifest 仍是模型可见接口。

#### Token 影响

本包没有额外 Token 消耗。Skill 目录和 Tool 事件保留原有开销。

#### KV Cache 影响

本包不直接影响 KV Cache。热发布的 Skill revision 可以通过既有业务 Skill 运行时改变后续模型输入。

## 已知限制与后续工作

- 纯配置新增仅限已经注册的只读 action。新数据源、复杂计算、写操作、凭据策略或授权模型需要修改 Gateway 代码并单独重启 Gateway，但不需要修改小薇源代码或重启小薇。
