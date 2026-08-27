# @deepseek-ai/dsh-ops-platform

[English](README.md) | 中文

ops 产品组的能力注册表和风险分类体系。插件最终会公开 `ctx.opsPlatform`，使 harness 与 ops Subagent 可以枚举已注册能力（Skill、MCP、Subagent）、验证请求执行是否匹配已批准授权（`risk_level` + `execution_version` + `arguments_hash`），并解析下游编排器使用的规划器提示（`after`、`requires`、`step_id`）。

风险分类体系区分三个等级：`R1`（只读、影响范围小）、`R2`（副作用在 agent 范围内可逆）和 `R3`（不可逆或超出范围的影响，需要显式批准）。该分类体系在此预留，并与首个能力 manifest 一同落地。

当前插件是第 1 阶段骨架，仅预留 `ctx.opsPlatform` 接口和配套 invariant 注册。schema 与风险分类体系会在首个场景声明能力 manifest 时落地。

## 插件

这是一个带 `inject: ['subagents']` 且没有运行时状态的函数插件。首个需要能力注册表的场景接入时，通过 `cordis.patch.yml` 配置项挂载。

## 配置

无。配置随首个能力 manifest 一同落地。

## 模型体验

无。当前骨架不注册服务、事件、提示词或工具。

#### KV Cache 影响

无。挂载该骨架不会改变请求前缀。

## 已知限制与延后工作

- **仅有骨架**：尚未注册风险分类体系；首项能力随其场景一同落地。已预留但未注册 `ctx.opsPlatform`。
