# Subagent 场景模板

[English](README.md) | 中文

将此目录复制到 profile 的 `cordis.yml` 旁，将 `hello_subagent.py` 重命名为场景的 snake_case 名称，并同步更新 `cordis.patch.yml`。Python 对等实现通过 `@deepseek-ai/dsh-ops-subagent-python` 在 stdio 上使用 JSON-RPC 2.0；patch overlay 同时挂载提供方配置项和一次性调用方，后者驱动一次 `agent.turn` 以验证协议。

## 文件

- `hello_subagent.py`：Python 对等实现。处理 `initialize` 和 `agent.turn`；当场景产生可观察状态时发出 `session.event` 通知。
- `cordis.patch.yml`：挂载 `dsh-ops-subagent-python` 以及用于冒烟测试的轻量调用方 preset 的 patch overlay。

## 命名

`hello_subagent.py` 是占位符。将文件重命名为场景的 snake_case 名称，更改 `cordis.patch.yml` 中的 `module:` 值以匹配（使用 `-m scenario_name.peer_main` 调用时写 `scenario_name.peer_main`），并将 preset id 从 `ops-hello-subagent` 重命名为 `ops-<scenario>`。

## 协议

Python 对等实现从 stdin 读取换行分隔的 JSON-RPC 2.0 消息，并向 stdout 写入响应／通知。提供方在 [`@deepseek-ai/dsh-ops-subagent-python`](../../../../packages/ops/ops-subagent-python/README.zh.md) 中记录完整 schema。模板只实现正常生命周期中提供方调用的两个方法：

| 方法 | 方向 | 时机 |
|---|---|---|
| `initialize` | 请求 | 生成后执行一次，位于所有 `agent.turn` 之前 |
| `agent.turn` | 请求 | 每次 `ctx.subagents.start(...)` 调用执行一次 |

对等实现可以随时发出 `session.event` 通知；提供方会将其转发到父会话日志。

## 挂载

```sh
PYTHONPATH=docs/ops/templates/subagent \
  pnpm dsh --profile headless --patch docs/ops/templates/subagent/cordis.patch.yml "..."
```

`PYTHONPATH` 使重命名后的模块可以通过 `-m scenario_name.peer_main` 导入。提供方生成 `python3 -m scenario_name.peer_main` 并执行 JSON-RPC 握手。

## 验证

启动应用 patch 的 profile，并运行附带的调用方 preset。提供方生成 Python 对等进程、完成握手、发送一次 `agent.turn`，然后返回 stub 响应。成功运行会在父会话日志中产生一条以 `[hello-subagent stub]` 开头的 assistant 消息。

## 边界

Subagent 的每次 `start` 拥有一个会话，每个轮次拥有一段最终 assistant 文本。除非场景发布自己的存储，否则它不会持久化跨会话状态。提供方转发 `session.event` 通知，但不会把子进程 transcript 桥接到父日志；父级只看到最终结果。

只发布提示词内容且不需要自己的会话的场景，应改用 [Skill 模板](../skill/README.zh.md)。

Skill 与 Subagent 的边界规则、manifest 字段和生命周期义务见[场景集成约定](../../scenario-integration-contract.zh.md)。
