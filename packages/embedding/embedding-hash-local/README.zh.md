# `@deepseek-ai/dsh-embedding-hash-local`

[English](README.md) | 中文

用于开发与测试的离线确定性特征哈希提供方。它把 UTF-8 字节映射到可配置的正整数维度，并对结果执行 L2 归一化。身份由 `feature-hash-v1` 和配置维度构成。

它不是语义嵌入模型，不能用于宣称生产检索质量。通过 `apply(ctx, { id, dimensions })` 加载；注册受 effect 作用域约束，并会在上下文销毁时移除。

## Model Experience

### Request context and condition

#### What the model sees

模型不会直接看到任何内容。Knowledge Consumer 可以使用 `feature-hash-v1` 向量选择后续上下文，但本提供方不贡献提示词或工具结果。

#### Token effect

不消耗模型 token；哈希仅使用本地 CPU。

#### KV Cache effect

本提供方不改变模型请求前缀，也不暴露 KV cache。

## Known Limitations and Deferred Work

- **不具备语义质量** — 特征哈希提供确定性数值指纹，而不是语义相似度，不能作为生产检索质量实现。
- **仅限本地机制** — 远程推理、计费、重试和提供方健康状态属于生产嵌入适配器。
