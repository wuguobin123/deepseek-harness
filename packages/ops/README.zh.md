# ops

[English](README.md) | 中文

`ops` 是承载「小薇办公助手」（ServicePilot）的**产品组**，即 dsh agent harness 之上的业务层。它使 dsh 核心 seam 不必为任何单一产品特化；`ops-*` 包实现消费这些 seam 的企业工作台组件。

本组的每个包都**通过 dsh seam 注册**（`ctx.subagents`、`ctx.tools`、`ctx.sessionTitle`、`ctx.userApproval` 等），而非直接修改宿主运行时；宿主运行时策略、loader 冒烟测试和持久化目录仍决定它们是否对某个 profile 可见。

## 组约定

- **使用 dsh Cordis 词汇。** 每项贡献都通过 `ctx.effect()`、`ctx.on()` 或 `ctx.waterfall()` 进入。插件默认导出形式专用于 Service 子类；函数插件以具名方式导出 `name`、`inject`、`Config` 和 `apply`。
- **Python 业务运行时是 `ctx.subagents` 的对等实现。** `ops-subagent-python` 注册 Python subagent 提供方；my-agents 业务逻辑（ops-domain Pydantic 业务模型和 Skill 实现）在独立进程中运行，通过 stdio 交换 JSON-RPC 消息，不共享 Cordis 上下文。
- **My-agents 的生命周期边界留在业务侧。** 会话日志是每项模型可见事实的真源（「模型可见 ⟺ 已记录」invariant），因此 Python 侧通过发送 `session.event` 通知写入 ops-domain 事实；TS harness 负责投影、持久化和回放。
- **本组内不引入第三种原生框架。** Python 侧框架事务（LangGraph 状态图、FastAPI、OpenClaw 插件 loader）保留在 `my-agents/` 中，并由 dsh seam 替代，而非由另一个进程内框架替代。

## 包

| 包 | 角色 |
|---|---|
| [`ops-subagent-python`](./ops-subagent-python/README.zh.md) | `ops-python` subagent 提供方；生成运行 my-agents 业务逻辑的 Python 子进程，并通过 stdio 交换 JSON-RPC |
| [`ops-skill`](./ops-skill/README.zh.md) | 扫描 `skills/<name>/SKILL.md` 并在 `ctx.skills` 上公开条目的内置 Skill 提供方 |
| [`ops-domain`](./ops-domain/README.zh.md) | 为未来 TS 侧消费方预留 `ctx.opsDomain` 的 TypeScript 镜像 |
| [`ops-runtime`](./ops-runtime/README.zh.md) | 业务 Subagent 的 agent preset 容器；具体编排器（route_work、capability_runner、evidence_validator、OPDCA 等）在场景需要时落到此处 |
| [`ops-platform`](./ops-platform/README.zh.md)（骨架） | 能力注册表和风险分类体系；编排器为能力 manifest 和规划器提示使用的接口 |
| [`ops-approval-policy`](./ops-approval-policy/README.zh.md)（骨架） | 批准扩展：绑定到 `ctx.userApproval` 的 `risk`、`executionVersion`、`validForSeconds`、`argumentsHash` |
| [`ops-package-signing`](./ops-package-signing/README.zh.md)（骨架） | 分发式 Skill／Subagent bundle 的 HMAC-SHA256 包签名 |
| [`ops-loop-guard`](./ops-loop-guard/README.zh.md)（骨架） | `ctx.repeatToolReminder` 之上的五类循环检测 |
| [`ops-workbench-conversations`](./ops-workbench-conversations/README.zh.md)（骨架） | 带租户／操作者隔离和 SSE 事件投影的多轮对话接口；在场景需要多租户聊天历史时落地 |
| [`ops-workbench-memories`](./ops-workbench-memories/README.zh.md)（骨架） | OpenViking 记忆适配器；从已完成轮次自动提取记忆并以 Markdown 持久化；在场景需要跨会话记忆时落地 |
| [`ops-workbench-trigger`](./ops-workbench-trigger/README.zh.md)（骨架） | 跨会话触发器（cron + 事件监听器）；会话内提醒借用 dsh `schedule/schedule` |
| [`ops-workbench-anomaly`](./ops-workbench-anomaly/README.zh.md)（骨架） | 通过 `ctx.anomalies` 公开的异常检测服务；检测器随首个需要它们的场景落地 |

## 添加场景

场景通过[场景集成约定](../../docs/ops/scenario-integration-contract.zh.md)逐个添加。骨架模板位于 [`docs/ops/templates/`](../../docs/ops/templates/)：

- Skill 接入：将 [`templates/skill/`](../../docs/ops/templates/skill/README.zh.md) 复制到 `ops-skill/skills/<name>/`。
- Subagent 接入：将 [`templates/subagent/`](../../docs/ops/templates/subagent/README.zh.md) 复制到同级包。

OPDCA 编排器以及相关 route_work、capability_runner、evidence_validator preset **不**属于本计划；它们会在业务场景明确需要时落地。

## 另请参阅

- [组约定](../CLAUDE.md)：包 invariant、导出形式、`./invariant`
- [架构](../../docs/architecture.zh.md)：本组复用的能力 seam 词汇
- [Cordis 入门](../../docs/cordis-primer.zh.md)：`ctx.effect/on/waterfall` 语义
