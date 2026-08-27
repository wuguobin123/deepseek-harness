# `@deepseek-ai/dsh-ops`

[English](README.md) | 中文

dsh 生产 **ops** profile。它是在 [`dsh-base`](../base/README.zh.md) 之上运行的长期服务，并包含所有 `ops-*` 产品插件。webserver 配置项绑定 `127.0.0.1:18000`（可通过 `DSH_OPS_PORT` 覆盖），`ops-webserver` 注册精确的 `/health` 路由和一个小型 `/` 索引。systemd `WatchdogSec` 轮询 `/health` 检查存活状态。

## 运行

```sh
pnpm dsh --profile ops                # long-lived service
pnpm dsh --profile ops "smoke check"  # also run one task before idling
DSH_OPS_PORT=19000 pnpm dsh --profile ops
```

该 patch 直接叠加在 `dsh-base` 上。它插入：
- `code-runtime` worker thread
- `ops-startup`（位置任务 + 绑定端口提供方）
- `127.0.0.1:<DSH_OPS_PORT or 18000>` 上的 `webserver`
- `ops-webserver`（`/health` + `/` 处理器）
- `ops-domain`、`ops-skill`、`ops-runtime`、`ops-subagent-python`
- `ops-platform`、`ops-approval-policy`、`ops-package-signing`、`ops-loop-guard`
- `ops-workbench-conversations`、`ops-workbench-memories`、`ops-workbench-trigger`、`ops-workbench-anomaly`
- `ops-runner`（驱动可选前台任务；没有 `task` 时永久空闲）

## 插件导出

- `@deepseek-ai/dsh-ops`：`ops-runner`
- `@deepseek-ai/dsh-ops/startup`：`ops-startup`
- `@deepseek-ai/dsh-ops/webserver`：`ops-webserver`
- `@deepseek-ai/dsh-ops/invariant`：空 invariant 注册

## 模型体验

间接影响。组合中的各插件分别负责模型可见的提示词、工具与结果。

#### KV Cache 影响

无；ops 是服务组合，而非对请求字段的贡献。

## 已知限制与延后工作

- **My-agents Python 对等实现为按需使用。** `ops-subagent-python` 会挂载，但只有委派工具调用 `ops-python` 提供方时才生成 Python 子进程。默认 Python 入口为 `ops_runtime.subagent_main`；使用 `DSH_OPS_PYTHON_MODULE` 覆盖。
- **无 `/api` 网关。** 此 profile 只公开 ops 插件接口和 `/health`。Web GUI API 网关位于 [`dsh-web-app`](../web-app/README.zh.md)；需要该网关的生产部署会在反向代理后同时运行两个 profile。
- **无浏览器界面。** 此 profile 不发布 UI；HTTP `/` 索引仅用于运维人员快速检查。
