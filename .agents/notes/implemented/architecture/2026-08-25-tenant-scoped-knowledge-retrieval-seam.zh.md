# Agent Note: 租户范围知识检索 seam

Status: implemented

[English](2026-08-25-tenant-scoped-knowledge-retrieval-seam.md) | 中文

## Problem

私有知识同时涉及已认证的所有权、文档摄取、索引、检索和面向模型的引用。如果把它作为产物存储功能或工具专用向量数据库，存储选择就会决定模型 schema，而且其他调用路径可能绕过租户过滤。

## Decision

知识检索是一项能力 seam，Service Definition、Service Provider 和 Consumer 分属独立包。`@deepseek-ai/dsh-knowledge` 拥有 `ctx.knowledge`、带范围的操作类型、提供方选择、摄取字节上限和稳定引用字段。`@deepseek-ai/dsh-knowledge-sqlite-local` 拥有本地 SQLite 元数据、FTS5、向量和摄取后台任务实现。`@deepseek-ai/dsh-tool-knowledge` 拥有 `knowledge_search` schema、提示词指引、有界模型输出和回放展示。

Embedding 是一项独立能力，因为向量空间身份和模型选择与文档存储独立变化。`@deepseek-ai/dsh-embedding` 返回向量及模型、修订版和维度身份。`@deepseek-ai/dsh-embedding-hash-local` 是供测试和开发使用的确定性离线提供方，不声称具有语义检索质量。

每项知识操作都接收可信的 `KnowledgeScope`，其中同时包含 `TenantId` 和 `KnowledgeSubjectId`。提供方在每次所有权查询和变更中都包含这两个值。未知或外部范围资源标识符与不存在资源返回相同的未找到或空搜索结果。模型不能提供任何范围字段。

当前 Consumer 从持久会话 `ownerId` 派生个人租户范围，把该账户标识符同时用作租户和主体。未来的组织租户服务可以解析不同租户及其成员关系，但仍须在调用 `ctx.knowledge` 前生成同一可信范围；组织标识符不会进入工具 schema。

摄取接收 `AsyncIterable<Uint8Array>`。Service Definition 在提供方消费流时执行配置的总字节上限。提供方只在解析和 Embedding 成功后原子发布文档修订版及其分片；后台任务公开 queued、running、succeeded、failed 或 cancelled 状态。引用保留知识库、文档、修订版、分片、结构化位置、内容哈希、索引修订版和分数字段。

检索到的摘录只通过普通持久 `tool/call` 和 `tool/result` 事件到达模型。Consumer 用 `[K1]` 标记命中，保留稳定定位符，要求模型引用这些标签，并声明检索文本是不可信数据而不是指令。

## Alternatives considered

**用一个 RAG 插件包含所有层。** 这会缩短初始配置，但提供方替换、摄取演进和面向模型的 schema 变化会共用一个发布单元。组合包可以一起安装这些包，但不会合并其职责。

**复用产物或用户上下文存储。** 产物是交付输出，用户上下文保存较小的用户控制值。两者都不拥有文档修订版、检索排序、逐分片引用或每项操作的租户与主体授权。

**把租户标识符公开为工具参数。** 模型选择租户会把授权变成提示词行为。范围来自已认证会话状态，不出现在 JSON Schema 中。

**每个租户创建一个 collection 或数据库。** 每租户物理名称会增加生命周期复杂度，并可能在名称清理后发生碰撞。即使未来后端把物理分区作为优化，租户和主体复合列仍是权威依据。

**从图检索开始。** 图索引有助于全库问题，但会增加索引成本和失败模式。初始提供方在同一搜索约定后使用关键词和向量证据；图检索可以成为另一个提供方或路由策略。

## Consequences

包拆分在存储和 Embedding 提供方独立变化时保持模型工具稳定。租户隔离可以在提供方约定和模型 Consumer 两层测试，修订版身份让引用和索引兼容性可追溯。

初始本地提供方在单进程中支持有界 UTF-8 纯文本和 Markdown。它不是托管多写入者后端、文档转换器、OCR 系统、连接器框架或生产 Embedding 模型。已认证上传 API 和组织成员关系解析仍位于该 seam 之外，直到其 HTTP/RPC principal 载体能够提供 `KnowledgeScope`，而无需接受请求数据中的范围。

无密钥测试覆盖提供方选择、流上限、Embedding 身份、本地摄取与检索、稳定引用、工具范围派生，以及外部租户或主体标识符。生产后端必须通过相同的隔离负向用例，才能替换本地提供方。
