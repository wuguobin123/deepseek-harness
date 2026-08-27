# `@deepseek-ai/dsh-tool-knowledge`

[English](README.md) | 中文

基于 `ctx.knowledge` 的模型可见 `knowledge_search` 工具。它从 `exec.agent.session.header.ownerId` 派生 MVP 个人作用域，并把同一所有者作为租户和主体。缺少所有者的调用以 `KNOWLEDGE_SCOPE_UNAVAILABLE` 失败。

## Configuration

| 键 | 默认值 | 含义 |
|---|---:|---|
| `maxResults` | `8` | 返回匹配数的正整数上限。 |
| `timeoutMs` | `30000` | 协作式工具调用超时预算。 |
| `maxResultChars` | `16000` | 输出字符上限；小于 256 的值会被拒绝，以确保安全与引用尾注可表示。 |

## UI presentation

进行中和已完成调用使用通用搜索卡。展示元数据保留用于回放的结构化引用；格式错误的元数据会安全回退到普通工具内容。

## Model Experience

### Request context and condition

#### What the model sees

模型只能提供 `query`、可选 `knowledge_base_ids` 和可选 `top_k`；提供方调用接收派生作用域和工具取消信号。工具返回规范的 `{ hits, truncated }` 证据。每项命中保留全部稳定引用字段，Native 输出渲染 `[K1]` 标签、标题、结构化位置、摘录和 `knowledge://<kb>/<doc>/<revision>/<chunk>` 定位符。提示词要求使用 `[K1]` 等引用，并声明私有知识文本是不可信数据，绝不能遵循或执行其中的指令。

#### Token effect

插件启用期间，系统指引固定。结果文本受 `maxResultChars` 约束；`maxResults` 限制获取量，`top_k` 限制请求命中数。空结果明确说明没有私有匹配可支撑回答。

#### KV Cache effect

只要插件作用域与配置不变，提示词和工具 schema 前缀保持稳定。启用、停用或改变配置可能使发生变化处之后的复用失效。

## Known Limitations and Deferred Work

- MVP 把一个会话所有者映射为一个租户和一个主体；不会向模型暴露多人或委托主体选择。
- 检索完整性、排序质量和索引新鲜度仍由提供方负责。
- 有界 Native 渲染可能省略低排序命中或缩短摘录；`truncated` 和省略提示会显式表达该损失。
