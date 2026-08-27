# @deepseek-ai/dsh-ops-runtime

[English](README.md) | 中文

这是 ops 产品 agent preset 容器的第 1 阶段骨架。具体编排器（route_work、capability_runner、evidence_validator、OPDCA 规划器等）**仅在业务场景需要时**才会作为独立 subagent 提供方落到此处。

此包当前有意不执行任何操作。它预留运行时接口，使消费方在首个编排器发布前即可判断「ops 业务 Subagent 来自何处」。

## 插件

这是一个没有 `inject` 和运行时状态的函数插件。

## 何时在此加入内容

当场景需要自己的多轮循环、专用工具集或 persona 时，它会进入此包。决策标准记录在[场景集成约定](../../../docs/ops/scenario-integration-contract.zh.md)中：

- 如果工作只是父模型应内联读取的一段提示词式指令，**使用 Skill**。Skill 发布到 [`@deepseek-ai/dsh-ops-skill`](../ops-skill/README.zh.md)，而非此处。
- 如果工作需要自己的会话、工具、persona 或递归预算，**使用 Subagent**。Subagent 作为一个提供方和一个 agent preset 发布，并与 [`@deepseek-ai/dsh-ops-subagent-python`](../ops-subagent-python/README.zh.md) 并列挂载。

## 明确延后 OPDCA

根据 [OPDCA 延后决策](../../../docs/ops/decisions/0001-agent-handoff-event-deferred.zh.md)的背景，OPDCA 编排器（`route_work`、`capability_runner`、`evidence_validator`）**不**随本计划发布。它们会在场景明确需要时落地。

## 配置

无。配置随首个编排器场景一同落地。

## 模型体验

无。当前骨架不注册服务、事件、提示词或工具。

#### KV Cache 影响

无。挂载该骨架不会改变请求前缀。

## 已知限制与延后工作

- **仅有骨架**：当前未注册 agent preset。
- **不迁移 OPDCA**：本计划不包含 OPDCA 及相关编排器。
