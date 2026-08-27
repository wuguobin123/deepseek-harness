# @deepseek-ai/dsh-ops-workbench-memories

[English](README.md) | 中文

这是 ops 工作台记忆适配器的第 1 阶段骨架。此包为 ops 产品适配 OpenViking 记忆存储：从已完成轮次自动提取记忆、以 Markdown 持久化，并通过 `ctx.memories` 公开。

当前插件不执行任何操作。OpenViking 适配器随首个需要跨会话记忆的场景一同落地，并同时提供其存储后端和提取约定。

## 插件

这是一个声明 `inject: ['sessions']` 的函数插件，使未来的 OpenViking 适配器可以附加到会话生命周期。首个跨会话记忆场景接入时，通过 `cordis.patch.yml` 配置项挂载。

## 配置

无。配置随 OpenViking 适配器一同落地。

## 模型体验

无。当前骨架不注册服务、事件、提示词或工具。

#### KV Cache 影响

无。挂载该骨架不会改变请求前缀。

## 已知限制与延后工作

- **仅有骨架**：已预留但未注册 `ctx.memories`。OpenViking 适配器随首个需要跨会话记忆的场景一同落地。
