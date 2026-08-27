# `@deepseek-ai/dsh-artifact`

[English](README.md) | 中文

面向 HTML、幻灯片、文档、表格和图表的持久制品注册表 Service Definition。`ctx.artifactRegistry` 接受有大小限制的字节，返回按内容寻址的 `ArtifactRef`，并在读取制品时执行 workspace 与 Session 归属检查。

## 服务接口

`ArtifactRegistry.write()` 在委托存储前校验种类、媒体类型、来源、归属、内容大小与元数据。`get()` 解析一个所属制品，`list()` 返回 workspace 与可选 Session 可见的有界记录。`ArtifactError` 区分准入、未找到、归属与存储失败。

## 模型体验

间接影响。生成制品的工具负责其模型 schema，并渲染返回的引用。

#### KV Cache 影响

注册表本身无影响。生成工具在请求组装后增加自己的 schema 与结果。

## 已知限制与后续工作

- **该 seam 不渲染制品。** 客户端展示与导出格式属于 consumer。
- **按 id 的内容不可变。** 替换字节会创建新摘要与制品 id，不会更新已有对象。
