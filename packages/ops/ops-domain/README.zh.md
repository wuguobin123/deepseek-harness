# @deepseek-ai/dsh-ops-domain

[English](README.md) | 中文

这是 ops 产品组 TypeScript 领域镜像的第 1 阶段骨架。实际业务领域模型（Pydantic 类型、状态机、版本感知的批准）位于 [`@deepseek-ai/dsh-ops-subagent-python`](../ops-subagent-python/README.zh.md) 后面的 Python 对等实现中。

此包预留 `ctx.opsDomain` 接口，使未来的 TS 消费方无需等待 Python 往返即可读取快照类型或附加投影单元。当前插件不执行任何操作；场景逐个接入，并与其 Python 对等实现和约定测试一同落到此处。

## 插件

这是一个没有 `inject` 和运行时状态的函数插件。首个需要 TS 侧镜像的场景接入时，通过 `cordis.patch.yml` 配置项挂载。

## 配置

无。配置随首个 TS 侧场景一同落地。

## 模型体验

无。当前骨架不注册服务、事件、提示词或工具。

#### KV Cache 影响

无。挂载该骨架不会改变请求前缀。

## 已知限制与延后工作

- **仅有骨架**：已预留但未注册 `ctx.opsDomain`。不计划批量迁移 my-agents 的 `operations_*`；场景通过 [`docs/ops/scenario-integration-contract.md`](../../../docs/ops/scenario-integration-contract.zh.md) 逐个进入。
- **无 TS 侧验证**：领域完整性由 Python 对等实现负责。未来的 TS 消费方不得尝试在 TS 中验证 Python 模型。
