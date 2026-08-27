# @deepseek-ai/dsh-ops-workbench-trigger

[English](README.md) | 中文

这是 ops 工作台跨会话触发器接口的第 1 阶段骨架。此包承载 ops 产品的跨会话触发器（cron + 事件监听）；会话内提醒借用 [`@deepseek-ai/dsh-schedule`](../../schedule/schedule/README.zh.md)，此包则增加跨会话部分，即 `@schedule` 全局触发器和事件订阅。

当前插件不执行任何操作。全局触发器实现随首个需要跨会话提醒的场景一同落地。

## 插件

这是一个声明 `inject: ['sessions']` 的函数插件，使未来的全局触发器实现可以附加到会话生命周期。首个跨会话提醒场景接入时，通过 `cordis.patch.yml` 配置项挂载。

## 配置

无。配置随全局触发器实现一同落地。

## 模型体验

无。当前骨架不注册服务、事件、提示词或工具。

#### KV Cache 影响

无。挂载该骨架不会改变请求前缀。

## 已知限制与延后工作

- **仅有骨架**：已预留但未注册 `ctx.triggers`。全局触发器实现随首个需要跨会话提醒的场景一同落地。
