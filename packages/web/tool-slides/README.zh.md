# `@deepseek-ai/dsh-tool-slides`

[English](README.md) | 中文

用于 Reveal.js 演示文稿的 `slides_build` 交付工具。它把封面与有序 Markdown 幻灯片渲染为带内联主题的自包含 HTML，持久化 `kind: 'slides'`，并返回预览元数据。

## 演示文稿格式

输入包含可选封面、主题、标题和形如 `{ title?, bodyMarkdown }` 的正文幻灯片。渲染器负责 Reveal.js 页面结构与内联资源；制品面板直接加载交付字节。

## 模型体验

### 工具 schema

#### 模型看到的内容

生成的 [`slides_build` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-slides) 接受可选封面与主题，以及有序幻灯片内容数组。

#### Token 影响

一个工具定义与固定演示文稿编写指引进入请求。幻灯片源码由调用携带，结果保留紧凑制品元数据。

#### KV Cache 影响

schema 与指引是稳定前缀内容。每次演示文稿调用与结果追加在该前缀之后。

## 已知限制与后续工作

- **只有一种交付格式。** 本包生成 Reveal.js HTML，不生成 PPTX 或 Google Slides。
- **没有 PDF 导出。** 可打印演示文稿需要独立无头导出服务。
