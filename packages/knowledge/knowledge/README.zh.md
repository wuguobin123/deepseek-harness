# `@deepseek-ai/dsh-knowledge`

[English](README.md) | 中文

`KnowledgeRuntime`（`ctx.knowledge`）定义带作用域的知识能力：知识库管理、有界流式导入、异步导入任务状态、文档删除和带引用的检索。它负责提供方注册与选择；提供方负责存储、解析、索引和租户授权。

## Service API

`registerProvider(provider)` 返回适用于 fiber/HMR 的 disposer，并拒绝重复 id。每项操作都接收可信 `KnowledgeScope`，其中同时包含租户与主体身份，并带有显式 `AbortSignal`。运行时选择配置的提供方，或唯一可用的提供方；缺失、不可用和歧义选择会抛出带开放字符串机器码的 `KnowledgeError`。

`search()` 接受零个或多个知识库 id（省略表示作用域内全部知识库），把受限的 `maxResults` 转发给提供方，并截断超量结果。每项命中携带稳定的知识库、文档、修订、分块、标题、结构化位置、摘录、内容哈希、索引修订和分数字段。`KnowledgeContent` 是 `AsyncIterable<Uint8Array>`，因此导入无需缓冲完整文档。

运行时会在声明的 `byteLength` 超限时于调用提供方前拒绝，并在提供方消费每个流式分块时执行配置的正整数 `maxIngestBytes` 限制。超限会抛出 `KNOWLEDGE_CONTENT_TOO_LARGE`。提供方必须把完整的租户与主体作用域用于读取、写入、检索和删除；作用域来自可信调用方，绝不是模型字段。

## Provider and consumer roles

本包是 Service Definition。提供方适配器实现 `KnowledgeProvider`；工具或应用包作为 Consumer，负责模型可见 schema、提示词和引用展示。作用域由可信调用方提供，并刻意排除在模型字段之外；提供方必须对包括读取和删除在内的每项操作强制执行作用域。

## Model Experience

### Request context and condition

#### What the model sees

模型不会直接看到任何内容。Consumer 可以渲染有界的 `ctx.knowledge.search()` 命中和稳定引用，同时不向模型暴露租户、主体和提供方凭据。

#### Token effect

不直接增加 token。Consumer 负责检索摘录与引用指令产生的 token。

#### KV Cache effect

本服务不改变模型请求。Consumer 可以在可复用前缀之后附加可变工具结果。

## Known Limitations and Deferred Work

- 不内置解析器、存储、授权策略、嵌入模型或索引实现。
- 提供方可用性仅是低成本本地检查；健康探测和逐提供方诊断尚未实现。
- 运行时只强制一个配置的结果上限和导入字节上限；排序、过滤、分页、断点续传和索引一致性由提供方负责。
