# Agent Note: 桌面助手穷举 `turn/end`、对称订阅及工具／用户问题渲染

Status: implemented

[English](2026-08-23-desktop-assistant-2-query-stall-and-tool-rendering.md) | 中文

## 问题

`apps/desktop/` 中的 Electron 桌面客户端通过单个 `/api/events.mux` WebSocket 下行链路运行助手页面。`apps/desktop/src/renderer/features/assistant/AssistantContext.tsx` 中的 reducer 把每个终止信号归入三个分支之一，即 `reason.kind ∈ {error, completed, cancelled}`，并忽略其他值；因此，只要宿主发出带其他 `reason.kind` 的 `turn/end` 帧（工具循环短路、model/throttled 子类、格式错误的信封），`state.running = true` 就会静默滞留。由于 `AssistantPage.sendDraft`（`apps/desktop/src/renderer/features/assistant/AssistantPage.tsx:64`）会在 `state.running` 时提前返回，该会话之后的每次发送都会成为无响应点击：用户消息不渲染，也不显示错误。从全新会话开始完成两次正常提示词后即可复现该缺陷。

同一个 `AssistantContext` 通过修改副作用的 `AssistantBridge` 子组件向页面公开 `attachSession`；该函数已经位于 context 值上，因此 bridge 是冗余的渲染时修改，也使 StrictMode 双重挂载下的订阅生命周期更难判断。

桌面助手还丢弃宿主发出的每个非文本帧：已有处理器（`AssistantContext.tsx:147-180`）会忽略 `tool-call`／`tool-result` 活动，`user-questions/requested` 信封则没有进入输入区的路径。webUI（`packages/client/*`）把二者渲染为行内工具卡和接管输入区的多问题表单；桌面端作为严格子集，会隐藏助手实际执行的操作，而且在宿主提问时无法作答。

## 决策

`AssistantContext.tsx` 现在穷举处理 `turn/end`：`error` 分派 `'error'`；`completed`／`cancelled` 分派 `'final'`；其他值分派带 `console.warn` 的 `'final'`，使未知 `reason.kind` 可诊断但绝不会卡住输入区。reducer 联合类型新增三种 action：`'tool/event'`、`'questions/pending'`、`'questions/answered'`；它们由 `AssistantTurnState`（`apps/desktop/src/renderer/features/assistant/types.ts`）中的两个新状态切片 `tools: ToolEvent[]` 和 `pendingQuestions: UserQuestionsRequest | null` 支撑。页面 `useEffect` 清理函数调用新的 `detach()` 方法，后者等待已有 `unsubscribeRef.current` 并清空引用，与提供方级别的对称拆除一致。冗余 `AssistantBridge` 子组件被删除；`useAssistant` 直接从 context 值读取 `attachSession`。

MuxFrame 处理器把 `tool-call`／`tool-result`（`tool-call`、`tool/call`、`tool_call`；`tool-result`、`tool/result`、`tool_result`，不同宿主版本名称不同）分派到单个 `ToolEvent` 切片，每类事件接受的三个别名汇聚到相同 reducer 路径。`user-questions/requested`（以及它的三种别名拼写）构建包含 `callId`、可选 `header` 和 `questions[]` 的 `UserQuestionsRequest`；提交时调用 `api.respond(callId, { answers })` 并分派 `'questions/answered'`，使文本输入区恢复。

新增的 `apps/desktop/src/renderer/features/assistant/ToolCard.tsx` 为每次工具调用渲染一个行内卡片：箭头、工具名称、状态标记（`running`／`completed`／`failed`／`cancelled`）和耗时；默认收起，点击后显示格式化的输入／输出 JSON。新增的 `apps/desktop/src/renderer/features/assistant/UserQuestionsForm.tsx` 为每个问题渲染一个 `<fieldset>`，每个选项对应一个 radio，并提供受条件控制的提交按钮；选中值汇总为 `{ [questionId]: optionLabel }` 并通过 `onSubmit` 转发。

`AssistantPage.tsx` 在消息列表与输入区之间插入来自 `state.tools` 的 `<ToolCard>` 行；`state.pendingQuestions` 非 null 时，以 `<UserQuestionsForm />` 替代文本输入区并禁用发送按钮。CSS 位于 `apps/desktop/src/renderer/styles.css` 末尾，复用 `--accent`、`--border`、`--surface-inset`、`--err`、`--radius-l`、`--font-mono` 以及已有 `.badge--{running|completed|failed|killed}` variant（第 1355、7497-7516 行）。没有新增 token 或色板。

## 考虑过的替代方案

**停止在 renderer 中修复，改为更新 `dsh-ops`。** 已拒绝，因为宿主的 `reason.kind` 集合是权威值；正确做法是修复宿主中的每个权威终止器，但在此之前，renderer 不得卡住自己的输入区。穷举分支和 `console.warn` 使故障在拥有自身防御性保护的 renderer 本地可见。

**把工具／问题帧作为行内类型化 variant 放入已有 `messages` 数组。** 已拒绝，因为宿主在 `assistant/chunk` 之外发出 `tool-call`／`tool-result`，插入边界属于轮次而非某条消息。单独的 `tools` 切片与 webUI 以名称为键的 `tool.call.toolview` 字段一致，并保持 `Message` 收窄。

**从 webUI workspace 引入 `@deepseek-ai/dsh-client-ui-tool`／`@deepseek-ai/dsh-client-ui-user-questions`。** 已拒绝，因为用户明确把第 1 阶段限定为在桌面端已有 React 树中重新实现交互。整体复用组件会增加 16 个以上 workspace 依赖，并使桌面端转向 Cordis 运行时，远大于本文交付的两个页面。

**在 `api.subscribeMux` 周围增加带重试上限的 WebSocket 重连循环。** 已拒绝，因为 main 进程 `startStream` 处理器已经在空闲超时时公开 `stream/error` 帧（`apps/desktop/src/main/ipc-handlers.ts:140-154`），renderer 已有 `'error'` reducer 分支会将其显示为 `page-assistant__error` 横幅。renderer 侧重试会掩盖已公开错误，并可能通过 `preload/index.ts:52-71` 重复订阅。穷举 `turn/end` 加对称 `detach()` 足以修复可复现症状；如果空闲断开频率以后成为问题，再跟进重连。

## 后果

无论宿主发出何种 `reason.kind`，轮次都会结束；输入区始终释放，`AssistantPage.sendDraft` 的 `state.running` 保护不再阻塞之后的发送。对运行中桌面端的 CDP 验证连续发送四个提示词，确认四条用户消息和四条 assistant 响应均写入；每轮后状态标记都回到「空闲」，没有 `page-assistant__error` 横幅。StrictMode 双重挂载保持对称：提供方 `useEffect` 清理与页面新 `detach()` 都调用相同的 `unsubscribeRef.current` disposer，因此 preload IPC 监听器注册不会跨重新挂载泄漏。

工具活动现在作为行内卡片显示在所属消息旁，running／completed／failed／cancelled 状态标记与 TasksPage 已有标记词汇一致。待处理的用户问题用 radio 表单接管输入区；提交通过 `api.respond` 返回，使宿主能够恢复。面向用户的界面增加两个视觉元素，但不引入任何 `@deepseek-ai/dsh-client-ui-*` 包。

验证通过 CDP 对已安装调试端口上的实时 Electron 构建执行（`/tmp/dsh-assistant-verify.mjs`）；测试保持之前约定套件的 9／9 基线，没有新增测试 fixture，因为变更是交互式而非纯函数式。第 2 阶段及以后（消息反馈、附件栏、侧边栏重构、设置分区、主题切换）仍然延后。
