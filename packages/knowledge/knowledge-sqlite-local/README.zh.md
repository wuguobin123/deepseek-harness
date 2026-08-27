# `@deepseek-ai/dsh-knowledge-sqlite-local`

[English](README.md) | 中文

面向 MVP 的本地单进程 `KnowledgeProvider`。它在一个自有 SQLite 数据库中存储元数据、不可变修订、分块、向量、导入任务和 FTS5 索引。每项操作都同时使用 `tenant_id` 和 `subject_id` 条件；不透明的知识库、文档、任务、修订和分块 id 不构成授权。

`startIngest()` 持久化 queued 任务后，纯文本和 Markdown 导入会异步执行。提供方消费受运行时限制的流、校验 UTF-8、按配置重叠切块、生成嵌入，然后以事务方式发布文档、修订、向量行、FTS 行和 succeeded 任务状态。失败与取消会成为终态，不会发布部分检索行。

检索使用归一化配置权重组合 SQLite `bm25()` 的倒数相关度和余弦相似度。只有已存储向量与查询向量的模型、修订号和维度完全一致时才进行向量比较。显式空知识库列表返回零命中；省略则表示作用域内全部可见知识库。

## Configuration

| 键 | 默认值 | 含义 |
|---|---:|---|
| `path` | `:memory:` | 自有 SQLite 数据库路径。持久部署必须配置文件路径。 |
| `id` | `sqlite-local` | 知识提供方注册 id。 |
| `chunkChars` | `1200` | 每个分块的正整数字符上限。 |
| `chunkOverlapChars` | `120` | 分块重叠字符数；必须小于 `chunkChars`。 |
| `keywordWeight` | `0.35` | 非负 FTS5 权重。 |
| `vectorWeight` | `0.65` | 非负余弦权重。至少一个权重必须为正。 |

## Model Experience

### Request context and condition

#### What the model sees

模型不会直接看到本提供方的内容。`dsh-tool-knowledge` 可以把有界的 `ctx.knowledge.search()` 命中渲染为带引用的证据，而租户和主体值始终是可信运行时数据。

#### Token effect

不直接消耗 agent 模型 token。嵌入适配器可能产生自己的 token 或计费成本，Consumer 控制检索摘录的 token。

#### KV Cache effect

本提供方不改变模型请求前缀。检索结果是可复用前缀之后的可变工具输出。

## Known Limitations and Deferred Work

- **MVP 解析器** — 只接受 UTF-8 `text/plain` 和 `text/markdown`；PDF、Office、HTML、OCR、来源位置提取和结构化解析插件尚未实现。
- **单进程存储** — 不包含分布式 worker、跨进程写协调、断点续传或远程向量数据库。
- **部署安全** — 静态加密、配额、留存、恶意文件检查、审计导出和组织成员授权属于后续产品层。
- **质量** — 不包含生产语义嵌入、重排、过滤器、评估数据集、相关性遥测和索引迁移／重建编排。
