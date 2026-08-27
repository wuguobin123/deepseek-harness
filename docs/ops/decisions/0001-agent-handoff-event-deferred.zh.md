# 0001 — 延后 `agent/handoff` 会话事件

[English](0001-agent-handoff-event-deferred.md) | 中文

Status: deferred Date: 2026-08-22 Owner: ops-runtime（未来）

## 背景

迁移计划第 0 阶段 P0.3 原本要求向 `KNOWN_SESSION_EVENT_TYPES` 添加 `agent/handoff` 会话事件，使编排器可以记录「本轮次的逻辑所有权从 agent A 转移到 agent B」。该事件使仪表盘和投影折叠无需分析每组 `subagent/descriptor` 与 `agent/inbox/inserted`，即可重建移交轨迹。

## 决策

延后。事件只在真实生产方落地时添加，不提前添加。

## 原因

`KNOWN_SESSION_EVENT_TYPES` 由仓库中 `SessionEventMap` 的声明合并生成。除非信封携带 `ignorable: true`，持久化读取路径拒绝解释集合外的任何事件类型（见[机制](../../../.agents/notes/implemented/architecture/2026-08-10-session-log-version-mechanism.zh.md)）。没有生产方声明的新事件类型：

1. 会成为悬空声明；目录校验器 `verify-persistence-catalog` 拒绝没有任何 `SessionEventMap` 成员生产的声明。
2. 任何尚不存在的代码路径都无法安全发出该事件。
3. 可能为名称附加与最终生产方不匹配的语义；针对过早字段构建的每个消费方都需要迁移。

[`AGENTS.md`](../../../AGENTS.md) 中「优先建立正确基础，而非兼容包装层」的预发布立场适用。当前没有消费方。

## 将重新引入它的生产方

`packages/ops/ops-runtime`（当业务场景决定采用编排器驱动的移交时）。候选字段为：

```ts ignore-check
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'agent/handoff'(
      this: Scoped<Agent>,
      payload: {
        from: Agent
        to: Agent
        reason: 'orchestrator-decision' | 'delegation' | 'failover'
        payloadRef: { sessionId: SessionId; sequence: number }
      },
    ): void
  }
}
```

`to` agent 必须已经存在（已发布的 subagent，或编排器通过 `ctx.agents.create()` 创建的 agent）；移交是关系声明，不是创建原语。事件保留在日志中；它不是 `surfaceOp`，绝不会进入模型历史。

## 在此之前

- `subagent/descriptor` 覆盖子项发布，并继续作为子 agent 已在父会话下发布的权威信号。
- `agent/inbox/inserted` + `agent/inbox/claimed` 覆盖一个 agent 内部的轮次转换。
- `agent.inject()`（[`core/agent-loop/src/agent.ts:130-132`](../../../packages/core/agent-loop/src/agent.ts)）是传递跨 agent 消息的机制；使用它不需要新事件。

`ops-runtime` 落地时，此决策文档会移到 `.agents/notes/implemented/process/`，事件声明与其生产方同时落地。
