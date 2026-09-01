# 小薇业务指标 Skill 验收

[English](xiaowei-business-metrics-acceptance.md) | 中文

日期：2026-09-01

## 结果

生产小薇 Host 已接入账号私有的 `xiaowei-business-metrics` Skill，当前活动版本为 revision 2。安装态小薇 0.3.44 客户端通过 `business_skill_call` 调用了 `registered-accounts` 与 `share-code-usage`，在 `2026-09-01T05:18:36Z` 返回注册账号 9 个、已使用邀请码 3 个。这两个值是可变生产数据的观测结果，不是固定预期值。

发布 revision 2 时只推进活动指针，没有替换 Host 进程。既有桌面 Session 随后的问答解析到了新版本，因此纯配置热加载路径与平台首次部署得到了独立验证。

## 安全证据

连接器通过回环地址上的 HTTPS 访问 `business.xiaowei.internal`。证书的主题备用名称包含该内部主机名，Node 信任部署方拥有的 CA，nginx 没有把该监听器暴露到公网。Host 在每次调用时解析服务凭据，并发送认证 Session owner；manifest 和模型输入都不包含这两个值。

端点探针对缺失或无效 Bearer 返回 401，对错误权限、租户 header、未知用户或未授权用户返回 403，对非 GET 请求返回 405。有效的注册账号和 owner 范围邀请码请求返回有界的 `{count, observedAt}` 响应。`userId` 只来自认证桌面状态，从未作为提示词或工具参数输入；小薇没有权威的租户成员选择，因此没有发送租户身份。

持久审计文件归 `root:root` 所有，权限为 `0600`。它为拒绝探针和安装态客户端调用记录操作、状态、观测时间和 trace id，不包含服务凭据名称或值。审计写入失败时，端点会在泄露业务结果前返回 503。

## 确定性证据

聚焦 Vitest 覆盖身份计数、owner 范围、连接器重试与 HTTPS 策略、运行时可信上下文传递、端点认证、权限、响应限制和失败关闭的持久审计。相关 TypeScript 项目引用与生产 bundle 均可成功编译。

## 恢复证据

集成前的源码树保存在 `/opt/dsh-xiaowei.pre-business-metrics-20260901T050600Z`。部署配置与两个 SQLite 数据库连同校验和保存在 `/opt/dsh-xiaowei-business-metrics-backup-20260901T045650Z`。回滚必须保留账号与业务 Skill 数据库，除非运维人员明确选择回滚数据。
