# 小薇注册用户明细验收

[English](xiaowei-registered-user-details-acceptance.md) | 中文

日期：2026-09-01

## 结果

生产环境当前运行 Gateway 配置 revision 3，以及账号私有的 `xiaowei-business-metrics` Skill revision 4、manifest 版本 1.2.0。新增的 `registered-user-details` 操作固定每页最多返回十项。每项只有 `maskedEmail` 和按天精度的 `registeredDate`；响应外层只有 `items`、`page`、`pageSize`、`hasMore` 和 `observedAt`。

部署只重启了 `dsh-business-gateway.service`，PID 从 `331311` 变为 `359705`。小薇保持 PID `274578`，启动时间为 `2026-09-01 13:17:53 CST`。之后热更新配置 revision 3 时，两个 PID 都没有变化。

## 权限与数据证据

生产 loopback 探针返回 HTTP 200，第一页有九项安全明细，`pageSize: 10`、`hasMore: false`。探针在不打印返回值的前提下，确认明细项字段集合和响应外层字段集合都符合要求。原有的注册账号数量、已使用分享码数量和未使用分享码数量操作继续返回 HTTP 200。

该操作要求 `users.details.read`。种子脚本只会为已经具有 `metrics.accounts.read` 的 subject-hashed grant 增加该权限；Gateway 每次请求仍会核对操作要求的精确权限。缺失或错误的 bearer、权限不匹配、tenant header 和未知用户仍会被拒绝。`userId` 和 `tenantId` 都不能作为业务输入。

最终状态探针确认 Gateway 有四项操作和一个 subject-hashed grant，配置和审计中没有服务凭据或原始请求者身份，审计文件权限为 `0600`。成功的 `/metrics/registered-user-details` 审计记录只包含 `at`、`operation`、`outcome` 和 `subjectHash`。

## 安装客户端证据

已登录的小薇 0.3.44 客户端通过账号 RPC 校验并发布了 Skill revision 4。前两次安装态尝试在工具分发前停止，因为账号唯一配置的 MiniMax-M3 模型返回了临时集群高负载错误 `PI_AI_ERROR (2064)`；模型服务恢复后，第三个新会话完成了调用。

成功的对话包含 `business_skill_call · registered-user-details`、九个脱敏邮箱结果和九个注册日期。验收探针没有发现未脱敏邮箱 token，也没有发现身份、租户、显示名或密码等禁止字段。`2026-09-01T08:01:57.117Z` 的匹配 Gateway 审计结果为 `ok`，且只包含 `at`、`operation`、`outcome` 和 `subjectHash`。

## 确定性检查

以下检查已通过：

```sh
pnpm exec vitest run packages/business/gateway/tests/gateway.spec.ts --config vitest.config.ts
pnpm exec tsc -b packages/business/gateway/tsconfig.host.json --pretty false
pnpm exec oxlint packages/business/gateway/src packages/business/gateway/tests --deny-warnings
pnpm exec tsdown --config packages/business/gateway/tsdown.config.ts
pnpm run verify-sdd
pnpm run verify-agent-note-format
```

聚焦测试包含十四个基于真实临时 HTTP 和 SQLite 实例的测试，覆盖确定性分页、末页、日期精度、脱敏、禁止字段缺失、独立授权、非法页码和身份输入、请求体拒绝、UTF-8 响应限制、不含明细的审计、原有三项操作、热加载，以及完整的 revision 3 种子配置。

## 恢复

已校验的部署前备份为 `/opt/dsh-business-gateway-backup-20260901T074738Z`。回滚时先把账号 Skill 回滚到 revision 3，再原子恢复备份中的 Gateway revision 2 配置；只有需要回滚执行代码时才恢复备份中的 Gateway artifact。不要重启小薇，也不要恢复或删除身份、Session、账号或 Skill 数据库。
