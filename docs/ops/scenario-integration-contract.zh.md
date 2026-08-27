# 场景集成约定

[English](scenario-integration-contract.md) | 中文

新业务场景进入 dsh harness 上 ops 产品的方式。本文是 Skill 与 Subagent 接入边界、命名规则、manifest schema、注册流程、生命周期和权限映射的唯一归属。每个场景只发布一种场景类型；混合类型会隐藏其生命周期并使资源释放含糊。

## 范围

- **范围内**：在 `packages/ops/` 或任何消费 profile 下添加场景的约定。
- **范围外**：场景内部的运行时语义（由实现它的包负责）。内置场景随 `ops-skill` 和 `ops-runtime` 包落地；本约定约束以后每项新增内容。

## 模式选择

场景采用两种模式之一。先选择模式，再编写 manifest。

| 模式 | 拥有 | 调用 | 会话 | 批准 | 典型示例 |
|---|---|---|---|---|---|
| **Skill** | 提示词片段和正文资源，无运行时 | 模型可见工具按需消费 | 无（模型在当前请求内读取） | 继承外围轮次的批准 | `oa_workbench`、`frontend_slides`、`next_best_action` |
| **Subagent** | 专用 agent preset、自己的会话和工具集 | 产生最终 assistant 文本或结束原因 | 每次启动一个会话（生成 `session_id`） | 自己的委派批准 | `route_work`、`capability_runner`、`evidence_validator` |

以下情况使用 Skill：

- 工作是一段父模型应内联读取的提示词式指令。
- 产物是正文或静态资源（Markdown、模板、小型脚本）。
- 不需要新的对话状态。

以下情况使用 Subagent：

- 工作需要自己的多轮循环、不同的工具或 persona。
- 结果是父级读取一次的完整答案，而非内联指导。
- 新会话可以保持父级 KV Cache 前缀稳定。
- 递归需要该 seam 拥有的深度预算。

两种模式都适用时，优先使用 Skill：Skill 不会意外嵌套进另一个 agent 的深度预算，也没有需要维护的子进程或会话生命周期。

## 命名

- Skill 名称：kebab-case，不能以数字开头，不含点；与 Skill frontmatter 的 `name` 字段一致。
- Subagent preset id：kebab-case；ops 产品场景使用 `ops.<scenario>` 前缀；运行时前缀成为 `ctx.subagents.start(...)` 的 `providerName` 参数。
- 能力 id（在工具 schema 中传给模型的字符串）：使用 `<skill-name>` 或 `<ops.subagent-id>`；不同类型之间不得冲突。
- 在 `ctx.subagents` 上注册的 Subagent 提供方名称中，以下名称已保留：`spawn`、`fork`、`acp`、`claude-code`、`codex`、`dsh-sdk`、`ops-python`。新场景选择不同名称；运行时拒绝重复注册。

## Skill manifest

Skill 位于磁盘上，并与公开它的提供方一同发布（本地根目录使用 `dsh-skill-filesystem`，嵌入内容使用自定义提供方）。提供方解析每个条目的 frontmatter 和正文，并在 `ctx.skills` 上注册。Skill 自身文件保持真源；本约定记录字段和生命周期，而非磁盘格式。

| 字段 | 必填 | 类型 | 含义 |
|---|---|---|---|
| `name` | 是 | kebab-case 字符串 | 注册表名称；与同一提供方层中的另一个 Skill 冲突时拒绝 |
| `description` | 是 | 字符串 | 模型可见摘要；由 loader 消费方限制长度 |
| `whenToUse` | 否 | 字符串 | 额外的面向用户提示；模型不可见 |
| `metadata` | 否 | 开放对象 | 自由形式的提供方或消费方载荷 |
| `disable-model-invocation` | 否 | 布尔值 | 为 true 时从模型可见目录排除 Skill |
| `user-invocable` | 否 | 布尔值 | 为 false 时从面向用户的命令面板排除 Skill |
| `body` | 是 | Markdown | 模型在调用 `skill(name)` 时读取 |

发现规则由 Skill 提供方负责；本约定只固定上表字段。调用策略以关闭方式失败：不接受的 camel-case 拼写或非布尔调用值会使整个 Skill 被丢弃，并发出警告。

Skill 不携带批准 manifest。读取 Skill 正文的风险就是外围模型调用的风险；父级批准链控制之后产生的副作用。

## Subagent manifest

Subagent 场景由 dsh agent preset 和按需启动 preset 的 subagent 提供方组成。此约定适用于进程内及进程外后端（`subagent-spawn-in-process`、`subagent-fork-in-process`、`subagent-acp`、`subagent-dsh-sdk`、`subagent-claude-code`、`subagent-codex`、`ops-subagent-python`）。

### 必填字段

| 字段 | 类型 | 含义 |
|---|---|---|
| `id` | ops 产品场景使用带 `ops.` 前缀的 kebab-case 字符串 | preset id，以及传给 `ctx.subagents.start(...)` 的 `<id>` 参数 |
| `preset` | agent preset 引用 | 挂载 agent 工具集、persona、系统提示词和生命周期的 `cordis.yml` 配置项 |
| `provider` | 已注册的 `ctx.subagents` 提供方名称 | 为此场景完成 `start` 的后端 |

### 可选字段

| 字段 | 默认值 | 含义 |
|---|---|---|
| `outputSchema` | 不存在 | 存在时，`ctx.subagents.start(...)` 按其验证最终 assistant 输出；只有子级自己拥有递归时，父级才声明 `maxDepth: 'provider-managed'` |
| `toolFilter` | 继承父级 | 子级可见的工具集；不存在时继承父级已注册工具，减去子 preset 排除的工具 |
| `persona` | 无 | 只为子会话替换全局 persona |
| `risk` | `R1` | `interaction/user-approval` 的风险等级（见「权限」） |
| `validForSeconds` | 0 | 为此场景授予的批准对相同 `arguments_hash` 的重复调用保持有效的时长；0 表示仅限单次调用 |
| `executionVersion` | preset sha | 批准绑定版本；批准链拒绝针对陈旧版本的授权 |
| `tags` | `[]` | 能力注册表和仪表盘使用的自由形式标签 |

### 示例

```yaml
- id: ops-capability-runner
  name: '@deepseek-ai/dsh-ops-capability-runner'
  config:
    providerName: ops-python
    risk: R2
    validForSeconds: 600
    executionVersion: 1
    tags: [orchestrator]
```

## 注册流程

场景通过三个入口之一加入 profile。规则是每个场景只使用一个入口；混用会重复生命周期并破坏资源释放。

### 1. 来自本地根目录的 Skill

挂载 `dsh-skill-filesystem`（或通过 `customSkillDirs` 扩展），使提供方扫描场景发布所在目录。Skill 不需要自己的 `cordis.patch.yml` 配置项；目录布局和 frontmatter 即为注册信息。

### 2. 作为运行时注册的 Skill

场景必须在插件内部发布时，从插件 effect 调用 `ctx.skills.register({ name, description, body, invocation: { modelInvocable, userInvocable }, provider: 'runtime' })`。运行时注册使用 rank `250`：项目 Skill 提供方覆盖它们，而它们覆盖本地根提供方的自定义行和用户行。

### 3. 通过 preset 注册 Subagent

Subagent 场景在同一组 `cordis.yml` patch 配置项中挂载其 agent preset 和提供方。通常使用两项：

```yaml
- id: ops-capability-runner-preset
  name: '@deepseek-ai/dsh-ops-capability-runner-preset'

- id: ops-subagent-python
  name: '@deepseek-ai/dsh-ops-subagent-python'
  config:
    providerName: ops-python
```

不需要提供方配置项的进程内 Subagent 只挂载 preset 配置项，并在父调用方中引用 `provider: spawn`。

ACP 或 SDK 驱动的 Subagent 在 preset 配置项旁增加相应的 `subagent-acp` 或 `subagent-dsh-sdk` 配置项。preset 配置项的 scope 保持为 agent 组合；提供方配置项的 scope 保持为协议。

## 生命周期

Skill 与 Subagent 的所有者不同。disposer 属于生成条目的注册表；其他组件不得将其拆除。

| 方面 | Skill | Subagent |
|---|---|---|
| 所有者 | 注册 Skill 的提供方 | `ctx.subagents.start(...)` 的调用方，通过返回的 run 持有 |
| 资源释放触发器 | 提供方卸载、层拆除、文件系统根失效 | `run.dispose()`（一次性）或 continuation manager（可继续运行） |
| 进行中的调用 | 丢弃；已经调用 `skill(name)` 的父级在请求历史中保留已加载正文 | 在 seam 边界以已知结束原因拒绝 |
| 轮次中的资源释放 | 不执行操作；Skill 正文已经进入工具历史 | `aborted` 结束原因；部分输出保持可见 |
| 资源释放后重新注册 | 提供方在下一次 `snapshot()` 时重新发现 | 新的 `start(...)` 生成新的 run id 和新子会话 |

在 effect 中注册 Skill 的插件**必须**返回 disposer；泄漏会在提供方重载后存活，并以陈旧元数据重新发布 Skill。Skill 注册表因此公开确切的 Cordis disposer。

Subagent 调用方丢弃 run 而不调用 `dispose()`，会为每个丢弃的引用泄漏一个子会话。seam 强制深度上限，但不负责引用计数；调用方对此负责。

## 权限

风险与批准 seam 将场景绑定到父级批准链。本约定固定 Skill 与 Subagent 共享的一套风险分类体系；父级批准接口从场景风险字段和已注册批准策略读取它。

| 等级 | 含义 | 默认批准 |
|---|---|---|
| `R1` | 只读；场景检查数据并返回文本 | 无 |
| `R2` | 可逆副作用（写数据库、发送聊天消息、加入后台任务队列） | 首次调用需要批准；`validForSeconds` 内的后续调用复用授权 |
| `R3` | 不可逆或外部可见的副作用（资金移动、公开发布、签发密钥） | 每次调用批准；忽略 `validForSeconds` |

批准链将 `approval.executionVersion` 与场景当前 `executionVersion` 比较，并将 `approval.argumentsHash` 与经 JSON 规范化的请求哈希比较；任一不匹配都会强制重新批准。复用批准会在 `validForSeconds` 到期或场景风险等级升高时失效。

Skill 没有风险字段，它们是纯提示词内容。其效果由外围模型轮次承载；父级批准链控制父级随后产生的副作用。

无论采用何种模式，父级轮次的循环防护都适用：使用相同参数重复加载 Skill，或针对相同参数重复启动 Subagent，都会受 `guard/repeat-tool-reminder` 中的五类检测约束（完全重复、乒乓循环、疲劳调用、研究停滞、未知能力重复）。检测在父级 `tools/pre-execute` waterfall 中运行，因此能统一观察每种模式。

## 模板

可直接使用的脚手架与本约定并列存放，并以不需要密钥的方式验证两种接入形式：

- [`templates/skill/`](templates/skill/README.zh.md)：供 `dsh-skill-filesystem` 使用的 `hello-scenario/SKILL.md` + `cordis.patch.yml`。
- [`templates/subagent/`](templates/subagent/README.zh.md)：供 `dsh-ops-subagent-python` 使用的 `hello_subagent.py` + `cordis.patch.yml`。
- [`templates/verify.py`](templates/verify.py)：与 Python 对等进程交换 JSON-RPC 并解析 Skill frontmatter 的无密钥冒烟测试；从仓库根目录使用 `python3 docs/ops/templates/verify.py` 运行。

## 交叉引用

- Skill 注册表约定：[`@deepseek-ai/dsh-skill`](../../packages/skill/skill/README.zh.md)。
- 本地 Skill 提供方：[`@deepseek-ai/dsh-skill-filesystem`](../../packages/skill/skill-filesystem/README.zh.md)。
- Subagent seam 约定：[`@deepseek-ai/dsh-subagent`](../../packages/subagent/subagent/README.zh.md)。
- Python Subagent 提供方：[`@deepseek-ai/dsh-ops-subagent-python`](../../packages/ops/ops-subagent-python/README.zh.md)。
- 用户批准扩展点：[`@deepseek-ai/dsh-interaction-user-approval`](../../packages/interaction/user-approval/README.zh.md)。
- 循环整理：[`@deepseek-ai/dsh-guard-repeat-tool-reminder`](../../packages/guard/repeat-tool-reminder/README.zh.md)。
