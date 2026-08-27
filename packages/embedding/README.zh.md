# embedding/ — 嵌入能力系列

[English](README.md) | 中文

本系列将与提供方无关的嵌入请求和具体向量实现分离。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`embedding/`](embedding/README.zh.md) | 定义嵌入提供方注册、选择、向量身份，以及查询／文档操作 | `ctx.embedding` |
| [`embedding-hash-local/`](embedding-hash-local/README.zh.md) | 为测试和本地开发提供确定性的离线向量 | 注册到 `ctx.embedding` |

生产语义嵌入适配器可以替换本地哈希提供方，而无需改变知识 Consumer。向量空间身份包含模型、修订号和维度，使索引能够拒绝不兼容向量。
