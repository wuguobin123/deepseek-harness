# `@deepseek-ai/dsh-artifact-store-fs`

[English](README.md) | 中文

[`dsh-artifact`](../artifact/README.zh.md) 的私有文件系统提供方。它在部署方拥有的根目录下保存按 sha256 寻址的对象与 JSON 元数据，原子发布，并把 `LocalArtifactRegistry` 挂载为 `ctx.artifactRegistry`。

## 配置与存储

`path` 选择私有存储根目录。`maxArtifactBytes`、`maxArtifactsPerSession` 与 `maxObjectBytes` 限制准入和枚举。对象字节按摘要去重；元数据保留制品种类、来源、归属、媒体类型、大小、时间戳与可选展示字段。

## 模型体验

间接影响。生成制品的 consumer 通过该后端持久化并渲染引用。

#### KV Cache 影响

无。文件系统位置与去重不会改变模型请求。

## 已知限制与后续工作

- **仅限单 Host 存储。** 提供方不协调跨机器写入，也不提供远端复制。
- **没有垃圾回收器。** 在部署方的保留策略删除未引用数据前，按内容寻址的对象会一直保留。
