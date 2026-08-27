# @deepseek-ai/dsh-ops-workbench-conversations

[English](README.md) | 中文

ops 产品的多轮对话接口。此包基于 dsh 的 `core/session` 和 `session-persistence-sqlite` 包隔离租户／操作者状态、传输会话消息，并向 SSE 消费方投影会话事件。它预留 `ctx.conversations` 投影，使未来的 TS 消费方无需等待新场景端到端落地即可读取对话历史或附加 SSE 消费方。

当前插件是不执行任何操作的骨架；对话投影随首个需要多租户聊天历史的场景一同落地。

## 插件

这是一个注入 `sessions` 且当前不公开运行时状态的函数插件。首个需要对话投影的场景接入时，通过 `cordis.patch.yml` 配置项挂载。

## 配置

无。配置随首个场景一同落地。

## 模型体验

无。当前骨架不注册服务、事件、提示词或工具。

#### KV Cache 影响

无。挂载该骨架不会改变请求前缀。

## 已知限制与延后工作

- **仅有骨架**：已预留但未注册 `ctx.conversations`。对话投影随首个需要多租户聊天历史的场景一同落地。
