# @deepseek-ai/dsh-tool-skill-install-local

[English](README.md) | 中文

用于桌面端监管的本机运行时中对话式安装的模型侧 `skill_install` Consumer。参数只有 `name`、`description` 与 `instructions`；目标位置完全来自启动器配置的 Harness home。子智能体会在提示用户前被拒绝。每次符合条件的调用都会在执行前进入标准的一次性审批机制；用户拒绝、审批通道不可用或审批策略为 `never` 时都会关闭式失败，不产生写入。

审批通过后，工具会校验 Skill 名称与编码后大小，拒绝符号链接和内容冲突的目标位置，通过原子目录重命名发布 `$DSH_HOME/skills/<name>/SKILL.md`，并在返回 `{ name, changed }` 前刷新 `ctx.skills`。模型不会获得本机文件系统路径。

## 模型体验

### 对话式安装

#### 模型看到的内容

模型提出一个编辑意图的 `skill_install` 调用。用户批准或拒绝该次准确安装。成功结果只说明 Skill 是新安装还是已经存在；之后的 Skill 发现无需重启本机 Host 即可找到新安装的 Skill。

#### Token 影响

固定工具 schema 会出现在挂载该 Consumer 的请求中；每次调用增加一条简短的持久工具结果。

#### KV Cache 影响

工具 schema 固定。安装成功后，Skill 目录 Consumer 可能追加一条新的完整目录替换消息。

## 已知限制与暂缓事项

- 工具只创建新 Skill，不覆盖或删除已有内容。
- 工具接受内联 Markdown 指令，不接受 URL，也不会从网络获取不受信任的压缩包。
- 子智能体不能安装 Skill，因为委派任务不得改变这台计算机的持久能力集合。
