# @deepseek-ai/dsh-ops-approval-policy

[English](README.md) | 中文

这是第 1 阶段的骨架，用四个场景侧字段扩展 `@deepseek-ai/dsh-interaction-user-approval`；ops 产品会把批准的授权绑定到这些字段：

- `risk`：能力 manifest 声明的 `R1`、`R2` 或 `R3` 等级。授权绑定到该等级，而非底层工具接口，因此降低等级会使未完成的授权失效。
- `executionVersion`：授权时捕获的 preset sha。授权绑定到创建时所依据的确切 preset 修订版；preset 升级会使未完成的授权失效。
- `validForSeconds`：授权的 TTL。`0` 表示仅限单次调用：即使参数完全相同，也不得在后续调用中复用授权。
- `argumentsHash`：请求参数的规范 JSON 哈希。只有传入参数的哈希仍与授权时捕获的哈希一致，授权才可复用。

当前包仅提供骨架：`ctx.userApproval` 保持不变，使用这些字段的策略解析器随首个需要它的场景一同落地。该骨架预留接口，使其他 ops 包可以在解析器仍处于设计阶段时依赖这些字段名编译。

## 插件

这是一个带 `inject: ['userApproval']` 的函数插件。首个 ops 场景需要策略解析器时，通过 `cordis.patch.yml` 配置项挂载。

## 配置

无。配置随首个驱动解析器的场景一同落地。

## 模型体验

无。当前骨架不注册服务、事件、提示词或工具。

#### KV Cache 影响

无。挂载该骨架不会改变请求前缀。

## 已知限制与延后工作

- **仅有骨架**：策略解析器随首个场景一同落地；当前 `ctx.userApproval` 保持不变。
