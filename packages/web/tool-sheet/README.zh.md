# @deepseek-ai/dsh-tool-sheet

[English](README.md) | 中文

`sheet_build` 把模型提供的数据行持久化为语义化 HTML 表格。`sheet_analyze` 从当前会话解析 XLSX 附件，读取一个有界工作表，推断文本列和数值列，并持久化包含表格、柱状图和饼图的自包含 HTML 分析页面。两个工具都通过 `ctx.artifactRegistry` 写入 `kind: 'sheet'`，因此现有制品面板会读取持久字节并在沙箱 iframe 中渲染。

## 模型体验

### 系统提示词

#### 模型看到的内容

固定指引说明 `sheet_build` 的数据行和列输入，并要求对 XLSX 的分析或可视化请求使用上传附件 ID 调用 `sheet_analyze`。

##### XLSX 分析指引

```markdown
When the user uploads an XLSX file and asks for analysis or visualization, call sheet_analyze with its attachmentId. The tool reads only a file owned by the current session and creates a right-side analysis page with a table, bar chart, and pie chart.
```

#### Token 影响

除表格构建指引中解析后的 `maxBytes` 值外，其余内容固定。

#### KV 缓存影响

插件可见性、指引文本与解析后的限制不变时保持前缀稳定。

### 工具 schema 与结果

#### 模型看到的内容

生成的 [`sheet_build` 与 `sheet_analyze` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-sheet) 接受结构化数据行，或当前会话 XLSX 附件 ID 及可选的从零开始工作表索引和标题。成功结果报告持久表格制品与已分析行数；展示元数据会打开表格卡片。

#### Token 影响

schema 成本固定。结果简短且与数据相关；HTML 制品字节不会插入模型历史。

#### KV 缓存影响

工具结果追加在可复用前缀之后；schema、配置或可见性变化可能从变化的定义处使复用失效。

## 已知限制与待完成工作

- 图表使用第一个非负数值列和第一个其他列，最多展示二十个分类。
- 页面只包含内联 HTML、CSS 和 SVG，不加载脚本或外部资源。
