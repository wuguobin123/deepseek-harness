# knowledge/ — 租户隔离的知识能力系列

[English](README.md) | 中文

本系列实现从有界导入到带引用的模型检索这一整条私有知识能力 seam。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`knowledge/`](knowledge/README.zh.md) | 定义按租户和主体隔离的知识库、导入、删除和检索操作 | `ctx.knowledge` |
| [`knowledge-sqlite-local/`](knowledge-sqlite-local/README.zh.md) | 提供本地 SQLite FTS5 与向量检索 | 注册到 `ctx.knowledge` |
| [`tool-knowledge/`](tool-knowledge/README.zh.md) | 向当前会话所有者暴露带引用的私有知识检索 | 注册到 `ctx.tools` |

模型不能提供租户或主体标识。可信调用方必须先派生完整作用域，再调用 `ctx.knowledge`；提供方将该作用域应用到每项存储和检索操作。
