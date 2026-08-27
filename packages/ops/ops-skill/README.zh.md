# @deepseek-ai/dsh-ops-skill

[English](README.md) | 中文

ops 产品组的内置 Skill 提供方。启动时扫描 [`./skills/`](./skills/)，以 `ops-skill` 提供方名称在 `ctx.skills` 上注册每个 `<name>/SKILL.md` 条目，并按需提供正文。场景通过在 `skills/` 下加入满足[场景约定](../../../docs/ops/scenario-integration-contract.zh.md)的目录逐个进入。

## 插件

函数插件。需要 `ctx.skills`。

## 布局

```
ops-skill/
  src/index.ts            # provider factory
  skills/
    <scenario-name>/
      SKILL.md            # frontmatter + body, re-read on every load
      references/         # optional resource directory
      scripts/            # optional scripts the model may invoke
```

每个场景目录作为一个 Skill bundle 发布。提供方只扫描一层；有意排除 `**/SKILL.md` 发现，与上游 `dsh-skill-filesystem` 提供方的接口一致。

## 添加场景

1. 将 [`docs/ops/templates/skill/`](../../../docs/ops/templates/skill/README.zh.md) 复制到 `skills/<scenario-name>/`。
2. 编辑 `SKILL.md` frontmatter（`name`、`description`）和正文。
3. 重新挂载插件或等待下一次 `ctx.skills.snapshot()`；提供方在每次 `skill(name)` 调用时重新读取。

字段 schema、Skill 与 Subagent 的边界及权限模型见[场景集成约定](../../../docs/ops/scenario-integration-contract.zh.md)。

## 配置

无。提供方没有可配置接口；rank 为 `BUNDLED_SKILL_RANK`（`600`）。

## 模型体验

间接影响。`@deepseek-ai/dsh-tool-skill` 会渲染本提供方的目录与所选指令正文。

#### KV Cache 影响

仅编辑正文不会改变目录摘要；编辑 frontmatter 会使注册表级别的提供方失效，并在消费方下次渲染时触发替换目录。

## 已知限制与延后工作

- **无 watch**：内置提供方在启动时扫描；热重载请使用指向此目录的 [`@deepseek-ai/dsh-skill-filesystem`](../../skill/skill-filesystem/README.zh.md)。
- **仅限内置内容**：运行时和远程 Skill 使用场景约定中记录的运行时注册路径。
- **仅扫描一层目录**：不会发现嵌套 Skill 树。
