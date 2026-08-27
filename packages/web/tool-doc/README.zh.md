# `@deepseek-ai/dsh-tool-doc`

[English](README.md) | 中文

用于语义 HTML 或 Markdown 文档的 `doc_build` 交付工具。它渲染有序 Markdown section，持久化 `kind: 'doc'` 制品，并返回文档预览面板所需元数据。

## 格式

`html` 是默认存储格式，会把渲染后的 section 包装成自包含页面。`markdown` 保留 Markdown 交付物。制品是事实来源；本包不生成 DOCX 或 Google Docs 文件。

## 模型体验

### 工具 schema

#### 模型看到的内容

生成的 [`doc_build` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-doc) 接受标题、输出格式和有序 `{ heading?, bodyMarkdown }` section。

#### Token 影响

一个工具定义与固定文档交付指引进入请求。模型提供 section 内容，保留结果只包含紧凑制品元数据。

#### KV Cache 影响

schema 与指引保留在可复用请求前缀中；文档调用与结果随后追加。

## 已知限制与后续工作

- **没有办公文档导出。** DOCX 与 Google Docs 输出需要独立 exporter。
- **本工具不生成 PDF。** 可打印输出属于独立 PDF 导出路径。
