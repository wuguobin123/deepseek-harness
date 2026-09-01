# 小薇独立 Business Gateway 验收

[English](xiaowei-business-gateway-acceptance.md) | 中文

日期：2026-09-01

## 结果

生产环境现在把 `https://business.xiaowei.internal/metrics/*` 路由到独立 systemd 管理的 `dsh-business-gateway.service`，其监听地址为 `127.0.0.1:18082`。部署前、nginx reload 后、Gateway revision 2 后、业务 Skill revision 3 后，以及安装态问答验收后，小薇 Host 始终保持 PID `274578`，启动时间始终为 `2026-09-01 13:17:54 CST`。

Gateway 配置从含两个操作的 revision 1 原子更新为含三个操作的 revision 2 时，进程始终保持 PID `331311`，启动时间始终为 `2026-09-01 15:05:19 CST`。这证明已经注册的只读 action 及其动态授权可以在两个进程都不重启的情况下生效。

## 数据与授权证据

切流前，回环地址直连探针通过两个迁移操作返回 9 个注册账号和 3 个已使用分享码。这些数字是可变生产数据在验收时的观测值。尚未配置的第三个路径返回 404。Bearer 无效返回 401；权限不匹配、tenant 身份、未知用户，以及存在但未授权的用户在聚焦或生产探针中返回 403。

原子更新到 revision 2 后，`share-code-unused` 通过回环监听和内部 HTTPS 连接都返回 200，数量为 0。更新后的配置不包含 SQL、凭据、原始账号身份或租户身份。配置与独立环境文件均为 `root:root`、权限 `0600`。

审计文件为 `root:root`、权限 `0600`。安装态调用为 `/metrics/share-code-unused` 写入 outcome 为 `ok` 的记录，其中只有 subject hash，没有原始账号 id 或凭据。真实 HTTP 测试证明审计无法持久化时，Gateway 返回 503 且不返回业务结果。

## 安装态客户端证据

已认证的小薇 0.3.44 客户端发布了 `xiaowei-business-metrics` revision 3，对应 manifest version 1.1.0 和三个操作。发布请求只携带 `manifestText` 与 `expectedRevision`；账号归属来自桌面端已有认证态。

新建的云端 Session 查询已认证所有者的未使用分享码数量。会话记录包含 `business_skill_call · share-code-unused`，并返回 `未使用分享码数量：0` 和观测时间 `2026-09-01T07:11:37.365Z`。对应 Gateway 审计 outcome 为 `ok`。

## 确定性检查

以下聚焦检查通过：

```sh
pnpm exec vitest run packages/business/gateway/tests/gateway.spec.ts --config vitest.config.ts
pnpm exec tsc -b packages/business/gateway/tsconfig.host.json --pretty false
pnpm exec oxlint packages/business/gateway/src packages/business/gateway/tests --deny-warnings
pnpm exec tsdown --config packages/business/gateway/tsdown.config.ts
```

测试套件包含 9 个基于真实临时 HTTP 与 SQLite 实例的用例，覆盖三个已注册 action、所有者隔离、严格配置字段、重复与不安全映射、数据库根目录约束、授权矩阵、请求输入拒绝、服务凭据不可用、同进程热新增、无效更新保留上一正常版本、仅所有者可读且不含秘密的审计，以及审计失败关闭。

## 恢复

切流前清单与带校验和的配置和数据库备份位于 `/opt/dsh-business-gateway-backup-20260901T065355Z`。如需回滚执行链路且不改变账号或 Skill 数据，应从该备份恢复 `/etc/nginx/conf.d/xiaowei-business-internal.conf`，运行 `nginx -t`，reload nginx，然后停止 `dsh-business-gateway.service`。upstream 回滚不得恢复或删除 `identity.sqlite`、`business-skills.sqlite`、Gateway 配置或审计数据。
