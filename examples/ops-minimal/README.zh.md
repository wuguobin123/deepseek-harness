# ops-minimal

[English](README.md) | 中文

第 0 阶段零里程碑示例。它挂载 `ops-subagent-python` 提供方，使其指向 Python stub 入口脚本（`ops_minimal.subagent_main`），并让父 harness 通过 JSON-RPC 协议驱动一次 `agent.turn`。

Python stub 位于 [`./ops_minimal/subagent_main.py`](./ops_minimal/subagent_main.py)，包含包 README 所记录的完整 `initialize`、`agent.turn`、`session.event` 生命周期。

## 此示例证明什么

- 提供方生成 `python3 -m ops_minimal.subagent_main` 并完成 JSON-RPC 握手
- `session.event` 通知从 Python 传到 TS，并写入父会话日志
- 一个 `agent.turn` 请求返回一个 `agent.turn.result` 响应，随后子进程完成资源释放

## 如何运行

```sh
PYTHONPATH=examples/ops-minimal \
  pnpm dsh --config examples/ops-minimal/cordis.yml --profile headless "hello, ops"
```

预期输出是一条来自 Python stub、以 `[ops-python stub]` 开头的 assistant 消息。

## 此示例没有证明什么（第 1 阶段及以后）

- 真实 LLM 调用（stub 绕过 `ctx.llm`）
- 完整 my-agents ops-domain、ops-skill 目录和 OPDOR 编排器
- 通过 `agent/handoff` 会话事件进行多 agent 移交
- 批准、循环检测、outbox

这些是第 1 至第 6 阶段的目标，单独跟踪。
