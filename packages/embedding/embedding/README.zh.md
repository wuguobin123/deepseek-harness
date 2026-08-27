# `@deepseek-ai/dsh-embedding`

[English](README.md) | 中文

本包定义 `ctx.embedding`，即文档和查询向量的提供方注册表。配置时必须显式选择提供方；未配置时，只允许存在一个本地可用的提供方。结果保留模型、修订号和维度，使索引能够校验向量空间身份。调用会传递 `AbortSignal`，提供方必须响应取消。

提供方通过带 effect 作用域的 disposer 注册，从而支持安全重载和测试。该 seam 不承诺语义质量；质量由具体提供方与模型负责。

## Model Experience

### Request context and condition

#### What the model sees

模型不会直接看到任何内容。Knowledge Consumer 可以使用 `ctx.embedding` 向量选择之后进入模型上下文的摘录，但本服务不贡献提示词或工具结果。

#### Token effect

不直接消耗 agent 模型 token。嵌入提供方的计费与分词由所选提供方负责。

#### KV Cache effect

本服务不改变模型请求前缀，也不暴露 KV cache。

## Known Limitations and Deferred Work

- **由 Consumer 负责兼容性** — 索引 Consumer 必须先比较模型、修订号和维度，再比较向量。
- **提供方覆盖范围** — 重试、远程适配器、提供方 token 计量和生产质量评估仍属于提供方工作。
