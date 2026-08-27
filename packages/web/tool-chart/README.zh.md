# `@deepseek-ai/dsh-tool-chart`

[English](README.md) | 中文

用于持久图表的模型工具。`mermaid_build` 把 Mermaid 源码保存为自包含 HTML 容器；`svg_build` 保存经过清理的 SVG 文档。两者都通过 `ctx.artifactRegistry` 写入 `kind: 'chart'` 制品。

## 安全与输出

Mermaid 图使用内联运行时，不依赖 CDN。SVG 准入要求 `<svg>` 根节点，并拒绝脚本、事件处理属性以及允许清单之外的元素或属性。成功调用返回图表卡片所需的制品元数据。

## 模型体验

### 工具 schema

#### 模型看到的内容

生成的 [`mermaid_build` 与 `svg_build` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-chart) 接受标题及 Mermaid 或 SVG 源码，并说明支持与拒绝的形式。

#### Token 影响

两个工具定义与固定图表指引进入请求；成功调用只保留紧凑制品元数据，不保留完整渲染字节。

#### KV Cache 影响

schema 与指引是稳定请求前缀内容。工具调用与结果追加在该可复用前缀之后。

## 已知限制与后续工作

- **不支持任意 SVG。** 即使浏览器能够渲染，不受支持的元素与属性仍会被拒绝。
- **没有可编辑图表工程。** 保存的是交付源码或渲染容器，不是可视化编辑器文档。
