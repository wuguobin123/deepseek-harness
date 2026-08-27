# `@deepseek-ai/dsh-tool-html`

[English](README.md) | 中文

用于自包含 Web 制品的 `html_build` 交付工具。它通过 `ctx.artifactRegistry` 持久化完整 HTML 字节，并返回沙箱 iframe 预览所需元数据。

## 交付约定

模型提供包含 doctype、head 与 body 的完整文档。预览不能获取外部资源，因此所有资源必须内联为数据或页面内容。可选结构化元数据与制品一同保存。

## 模型体验

### 工具 schema

#### 模型看到的内容

生成的 [`html_build` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-html) 接受完整 HTML 文档、可选标题与可选展示元数据。

#### Token 影响

一个工具定义与固定自包含交付指引进入请求。调用可能携带大段 HTML，结果只保留紧凑制品元数据。

#### KV Cache 影响

schema 与指引构成稳定前缀内容。生成的 HTML 只出现在追加的工具调用中。

## 已知限制与后续工作

- **不能加载外部资源。** 字体、图片、脚本与样式必须嵌入交付文件。
- **没有多文件站点 bundle。** 工具保存一个 HTML 文档，而不是目录树。
