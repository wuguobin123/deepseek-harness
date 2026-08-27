# @deepseek-ai/dsh-tool-skill-install

[English](README.md) | 中文

用于对话式 Skill 安装的模型侧 `skill_install` Consumer。参数只有 `name`、`description` 与 `instructions`；归属完全来自 `exec.agent.session.header.ownerId`。匿名会话与子智能体会在提示用户前被拒绝。每次符合条件的调用都会在执行前进入标准的一次性审批机制；用户拒绝、审批通道缺失或审批策略禁用时都会关闭式失败，不产生写入。审批通过后，工具通过 `ctx.accountSkillStore` 写入，并在返回 `{ name, changed }` 前刷新 `ctx.skills`。模型看不到账号 id 或服务端路径。

## 模型体验

### 对话式安装

#### 模型看到的内容

模型通过一个编辑意图 `skill_install` 调用提出安装方案，参数为 `name`、`description` 与 `instructions`。用户会看到本次准确调用，并且只批准或拒绝这一次安装。成功结果只说明指定 Skill 是新安装还是已经存在，不暴露账号或服务端路径。

#### Token 影响

固定工具 schema 会出现在挂载 Consumer 的请求中；每次调用增加一条简短的持久工具结果。

#### KV Cache 影响

工具 schema 固定。安装成功后，Skill 目录 Consumer 可能追加一条新的完整目录替换消息。

## 已知限制与暂缓事项

- 工具只创建新 Skill，不覆盖或删除已有内容。
- 子智能体不能安装 Skill，因为委派任务不得改变账号的持久能力集合。
- 部署必须组合审批应答器才能交互式安装；无人值守或通道不可用时会拒绝调用。
