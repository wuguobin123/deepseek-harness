# @deepseek-ai/dsh-ops-package-signing

[English](README.md) | 中文

为通过 ops 产品发布的 Skill、Subagent 和 MCP bundle 签名并验证。首个签名 bundle 与 HMAC-SHA256 验证器一同落地：签名器覆盖 bundle manifest 和 `PACKAGE.sig` 产物；验证器读取二者，对规范 manifest 重新计算 HMAC，并在允许 bundle 进入前与提供的签名比较。

此包目前提供骨架（`apply` 不执行任何操作）。它预留 `ctx.opsPackageSigning` 接口，使未来的 Skill 或 Subagent 提供方无需等待验证器即可在 manifest 中声明签名 bundle。

## 插件

这是一个带 `inject: ['fs']` 且没有运行时状态的函数插件（验证器会读取 manifest 和签名产物）。首个签名 bundle 接入时，通过 `cordis.patch.yml` 配置项挂载。

## 配置

无。配置随首个签名 bundle 一同落地。

## 模型体验

无。当前骨架不注册服务、事件、提示词或工具。

#### KV Cache 影响

无。挂载该骨架不会改变请求前缀。

## 已知限制与延后工作

- **仅有骨架**：签名功能随首个签名 bundle 一同落地；已预留但未注册 `ctx.opsPackageSigning`。
- **尚无验证器**：HMAC-SHA256 验证路径（manifest + `PACKAGE.sig`）已有规划但尚未实现。验证器落地前，消费方不得尝试通过此包验证 bundle。
