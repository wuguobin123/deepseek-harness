# ops-skill/skills

[English](README.md) | 中文

ops 产品组的内置 Skill 目录。每个子目录对应一个场景；条目 schema 见 [`../README.md`](../README.zh.md) 和[场景集成约定](../../../../docs/ops/scenario-integration-contract.zh.md)。

## 场景

| 场景 | 风险 | 状态 | 来源 |
|---|---|---|---|
| `next-best-action` | R1（只读） | 已迁移 | my-agents `skills/next_best_action` |

## 添加场景

将 [`docs/ops/templates/skill/`](../../../../docs/ops/templates/skill/README.zh.md) 复制到此处的新目录，编辑 frontmatter 和正文，并在上方添加一行。内置 Skill 提供方会在启动时读取该条目。
