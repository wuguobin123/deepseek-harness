# Specification-driven development

[English](README.md) | 中文

本参考文档定义 Harness 的规格驱动开发（SDD）。规格是实现开始前用于审查范围、职责、验收和证据的可审阅来源。

## 规格类型

- **平台**规格定义产品级规则、共享运行时假设和跨能力不变量。若规格描述用户可见的平台功能，使用 `feature` 类型。
- **能力**规格定义一个可复用的服务、提供方、工具或 Skill 及其可观察行为。若能力可以独立实现和验证，使用 `capability` 类型。
- **集成**规格定义外部系统、场景或包如何连接既有能力。若工作包含身份、凭据、操作或交接规则，使用 `integration` 类型。

架构层级使用 `kind: feature` 表示平台规格；“平台”是职责层级，而 `feature`、`capability`、`integration` 是机器可读的类型。

## 职责分层

规格负责人陈述用户或操作员结果以及稳定需求。实现负责人选择满足需求的包、接口和测试。集成负责人记录外部身份、凭据、操作风险、审批、重试、补偿和审计义务。评审者检查验收 ID 是否可观察，以及证据是否指向仓库相对路径的产物。发布或运维负责人确认所声明层级的已实现证据。

规格不能替代包 README、子系统参考或源码契约。详细 API 语义链接到这些归属文档；决策的范围和验收则链接回规格。

## 生命周期

`draft` 表示未完成且可以继续细化。`approved` 是实现输入：需求、验收 ID、负责人和适用的集成控制均已确定。`implemented` 记录已交付行为，并且每个验收 ID 至少列出一个仓库相对证据路径。`retired` 表示不再可用的契约，但保留追溯记录。

实现前，将请求归一为一种规格类型，指定非空负责人，为每个需求和验收项分配全局唯一 ID，并将决策记录为链接。实现期间保持规格与测试一致。完成前，为每项验收关联证据，并从 `implemented` 规格中移除未解决或将来时表述。

## 机器强制规则

`pnpm run verify-sdd` 校验 `docs/specs/` 下的每个英文规格，并在 `doc-sync` 和静态 CI 门禁中运行。它只接受 `feature`、`capability` 和 `integration` 类型，以及 `draft`、`approved`、`implemented` 和 `retired` 生命周期。重复 ID、缺少负责人或正文、逃逸仓库或不存在的证据路径，以及没有证据的 `implemented` 验收项都会被拒绝。

每个集成操作都应声明模式、风险、审批、幂等、重试、补偿和审计策略。读取操作为 R1 且无需审批。写入操作为 R2 或 R3，必须逐次审批、具备真实的幂等规则，并在 R2 时提供补偿。证据应注明使用模拟 Provider 还是真实外部系统；两者不能相互替代。

## 证据层级

证据从最窄到最强依次为：静态检查或单元检查证明局部规则；组装后的包测试或集成测试证明组合行为；可运行 smoke 证明配置路径；操作员或生产观测证明已部署层级。更强的声明可以引用多个层级，但不能把较弱产物当作更高层级的证明。`evidence` 中的路径均为仓库相对路径，并作为指向具体检查、fixture 或实现的链接接受评审。

`next-best-action` 能力是参考试点。其验收证据包括 [ops 模板验证器](../ops/templates/verify.py) 和组装后的 Skill 测试 [packages/ops/ops-skill/tests/loader-composition.spec.ts](../../packages/ops/ops-skill/tests/loader-composition.spec.ts)。

## 与现有记录的关系

SDD 负责工作项的需求和验收映射。`docs/ops/scenario-integration-contract.md` 中的 ops 场景集成契约负责 Skill 与 Subagent 的运行时边界、命名、清单、生命周期和权限。集成规格应引用该契约，而不是复制其内容。

[Agent Note](../../.agents/notes/README.zh.md) 记录持久仓库决策为何作出、哪些替代方案落选及其后果。规格记录必须满足的内容；Agent Note 记录为何应保留所选设计。非机械的 SDD 决策在改变流程时新增或更新 implemented process note。

## 模板和编写规则

从 [feature-spec](templates/feature-spec.zh.md)、[capability-spec](templates/capability-spec.zh.md) 或 [integration-spec](templates/integration-spec.zh.md) 开始。英文和中文 frontmatter 必须逐字节一致，正文结构保持镜像，并使用 `verify-translation-pairing --write` 维护 sidecar。先归一化规格，再实现，完成前收敛每一项验收。
