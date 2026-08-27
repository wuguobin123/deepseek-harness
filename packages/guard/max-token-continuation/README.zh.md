# @deepseek-ai/dsh-max-token-continuation

[English](README.md) | 中文

这个守卫把提供方的输出 token 上限转化为有界自动续跑。当最近一个模型步骤以 `max-tokens` 结束、且下一轮没有调用方消息排队时，它会追加一条带来源的内部提示，要求模型从截断处继续、不要重复规划，并直接执行下一个必要工具。正常完成会重置续跑链；人类直接输入也会重置。续跑链从 session 事件和持久化 inbox 投影重建，因此重启和重放也会保留序号。

守卫不会修改模型输出上限、重放被截断的工具调用，也不会把受限轮次标记为成功。每个受限轮次仍保留 `turn/end.reason.kind = max-tokens`；自动排入的是一个独立普通轮次，其结果可在会话日志中审计。

## 配置

```yaml
- id: max-token-continuation
  name: '@deepseek-ai/dsh-max-token-continuation'
  config:
    maxContinuations: 8
```

应用 schema 默认值后，`maxContinuations` 必须是正整数。它限制一个未被打断任务的连续自动轮次数。达到上限后，agent 进入空闲，用户可以检查部分结果或发送新提示。已经排队的调用方消息始终优先；守卫不会在其后追加自动提示。

## 模型体验

### 自动续跑上下文

#### 模型看到的内容

消息来源保留 `{ kind: 'plugin', plugin: 'max-token-continuation', form: 'notice', cause: 'max-tokens', fromTurn, ordinal, limit }`。折叠通知会显示当前续跑次数与配置上限。`fromTurn` 使调度幂等：同一受限轮次已经排队或记录的续跑不会重复追加。

##### 精确续跑提示词

```markdown
Continue the unfinished task from the exact point where the previous response was cut off. Do not restart, repeat the plan, or merely announce what you will do. For large HTML, documents, spreadsheets, tables, or code, prioritize completing and saving the artifact with html_build, doc_build, sheet_build, write, or edit; for a short chat request, close with a concise answer. Use the next required tool immediately when work remains, preserve completed work, and finish only after the task is actually complete.
```

#### Token 影响

固定提示只在受限轮次后加入，并成为保留历史。它不会改变提供方的请求上限。

#### KV Cache 影响

仅追加。续跑内容位于可复用请求前缀之后，不会使之前的缓存条目失效。

## 已知限制与暂缓事项

- 只有最新的 `assistant/chunk` finish 且 `reason.kind = max-tokens` 才能触发续跑；不会重放被截断的工具调用。
- 守卫无法恢复被模型适配器丢弃的未完成工具调用；下一轮模型必须重新发出一个完整调用。
- 提供方反复截断时仍会消耗 token，直到任务完成或达到 `maxContinuations`。
