# Agent Note: 脱敏注册用户明细

Status: implemented

[English](2026-09-01-masked-registered-user-details.md) | 中文

## Problem

注册账号聚合数量无法回答账号何时注册，也无法区分明细行。直接返回身份表会向模型及持久 Session 日志暴露账号标识、完整邮箱、密码材料和精确活动数据。

## Decision

封闭的 `registered-user-page` Gateway action 使用独立的 `users.details.read` 授权保护。它每页固定返回十条记录，每项只有脱敏邮箱和按天精度的注册日期。Gateway 只接受可选的正整数页码，执行固定只读查询，限制响应大小，并且只审计请求者 subject hash 和结果。

Skill manifest 把该操作暴露为 `registered-user-details`；它不接受 `userId`、`tenantId`、过滤器、排序表达式、字段选择、SQL 或凭据。注册 action 只重启了独立 Gateway；随后通过热配置启用了路由、授权和账号 Skill revision。

## Alternatives considered

**返回完整身份记录。** 这会暴露稳定账号标识、邮箱、密码摘要和与问题无关的运行元数据。

**返回显示名称和精确时间。** 首个运营场景不需要这些字段，但它们会提高识别能力和行为时间精度。

**复用 `metrics.accounts.read`。** 聚合数量访问权不代表可以查看个人记录，因此明细使用独立授权。

## Verification

十四个聚焦测试证明最小字段、确定性分页、独立授权、无效输入拒绝、UTF-8 输出限制、不含明细的审计、完整的 revision 3 种子配置，以及保留原有三项聚合操作。生产环境运行 Gateway 配置 revision 3 和 Skill revision 4。认证安装客户端的对话包含 `business_skill_call · registered-user-details`、九个脱敏结果、不含禁止字段，并产生匹配的成功 Gateway 审计记录；小薇保持同一进程。

## Consequences

脱敏邮箱和注册日期与其他信息结合后仍属于个人数据，且模型可见结果会进入 Session 历史。分页调用之间如果发生新注册，按页分页可能重复或跳过记录；这个有界运营视图不承诺事务一致的导出。
