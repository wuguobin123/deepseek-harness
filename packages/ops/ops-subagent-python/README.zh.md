# @deepseek-ai/dsh-ops-subagent-python

[English](README.md) | 中文

ops 组的 Python subagent 提供方。每个子进程都是一个新的 Python 解释器进程，运行 my-agents 业务逻辑（ops-domain Pydantic 业务模型和 Skill 实现），并通过 stdio 与父 harness 交换换行分隔的 JSON-RPC 2.0 消息。子进程不与父进程共享 Cordis 上下文。

这是 [`dsh-subagent-dsh-sdk`](../../subagent/subagent-dsh-sdk/README.zh.md) 的仓库内对等实现：该后端生成 TypeScript harness 子运行时；此提供方生成 Python 解释器，因此承载 Pydantic 领域模型的业务运行时可以留在生产效率最高的位置。

## 协议

第 0 阶段零里程碑有意保持最小协议：

| 方向 | 方法 | 载荷 |
|---|---|---|
| TS -> Python | `initialize` | `{ agentId, sessionId }`：握手，使 Python 侧能够解析 ops-domain 运行时 |
| TS -> Python | `agent.turn` | `{ messages, tools, context }`：一次模型请求 |
| Python -> TS | `agent.turn.result` | `{ content, tool_calls, stop_reason, usage }`：一次模型响应 |
| Python -> TS（通知） | `session.event` | `{ type, data }`：追加到父会话日志的仅追加 ops-domain 事实 |

Python 子进程从 stdin 逐行读取 JSON 对象并向 stdout 逐行写入；父 harness 解析行分隔 JSON。保留 JSON-RPC 2.0 framing，使后续阶段可以加入 `tool.call` 转发、`request.context` 注入，以及用于子进程向父进程发送消息的 `subagent.continuation`，而无需改变协议格式。

## 启动与所有权

`start(request)` 按与 SDK 和 ACP 后端完全相同的规则解析子进程工作目录（加载时一次验证配置覆盖值，否则使用委派父会话的 cwd，绝不使用服务器进程自身的 cwd），生成 `python -m <config.module>` 及配置的 `args`，随后执行 `initialize` JSON-RPC 握手。run 返回前握手已经完成，因此启动成功表示 Python 子进程已就绪。

返回的 run id 在父命名空间中生成；子会话 id 仅存在于 Python 进程中。发布后，提供方拥有子进程，并通过父会话日志转发所有 `session.event` 通知，使持久化、投影和 UI 回放都能反映 ops-domain 事实，而无需重新实现它们。

`dispose()` 关闭 stdin，等待 `disposeEofGraceMs`，随后升级到 SIGTERM（经过 `disposeGraceMs` 后再升级到 SIGKILL）。

## 能力与上下文

提供方不公布启动时能力（`outputSchema`、`depthLimit`、`toolFilter`、`persona` 均为 false），并设置 `inheritsParentContext: false`：子进程是另一个进程中的全新解释器，唯一来自父进程的输入是 workspace cwd。工具路由位于父进程侧；Python 侧在 `agent.turn` 载荷中看到工具定义并决定如何使用。

## 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `providerName` | `ops-python` | `ctx.subagents` 上的注册表名称。 |
| `command` | `python3` | 每次启动时生成的解释器。 |
| `module` | 必填 | Python 模块入口（例如 `ops_runtime.subagent_main`）。 |
| `args` | `[]` | 转发给模块的额外参数。 |
| `cwd` | 父会话 cwd | 工作目录覆盖值；验证规则与 SDK 后端相同。 |
| `env` | `{}` | 叠加到已清除凭据的父环境之上的显式子环境。 |
| `turnTimeoutMs` | 无限制 | 每个 `agent.turn` 请求的时间限制；超时后父进程将其视为错误。 |
| `disposeEofGraceMs` | `6000` | stdin EOF 后到平台终止前的宽限时间。 |
| `disposeGraceMs` | `3000` | SIGTERM 到 SIGKILL 的宽限时间；POSIX 在 SIGTERM 后等待这段时间再发送 SIGKILL。 |

```yaml
- id: ops-subagent-python
  name: '@deepseek-ai/dsh-ops-subagent-python'
  config:
    providerName: ops-python
    command: python3
    module: ops_runtime.subagent_main
    args: ['--wire=stdio']
    env:
      APP_TENANT: !!env APP_TENANT
```

## 另请参阅

- [`dsh-subagent`](../../subagent/subagent/README.zh.md)：提供方注册表约定和进程外辅助方法
- [`dsh-subprocess`](../../subprocess/subprocess/README.zh.md)：用于安全叠加子环境的 `scrubbedParentEnv`
- [`dsh-session`](../../core/session/README.zh.md)：转发 ops-domain 事件的 `session.append`

## 模型体验

间接影响。父级拥有的消息与工具定义会传入子运行时，供其模型请求使用。

#### KV Cache 影响

提供方启动不会增加父级请求前缀；子运行时为其独立请求负责缓存。

## 已知限制与后续工作

- **每个子运行使用一个进程。** 提供方没有解释器池或可持续的热进程。
- **只有最小协议。** 父级工具调用转发与可持续的子级到父级消息仍是推迟的协议扩展。
