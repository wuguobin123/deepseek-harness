# Skill 场景模板

[English](README.md) | 中文

将此目录复制到 profile 的 `cordis.yml` 旁，将 `hello-scenario/` 重命名为场景的 kebab-case 名称，并编辑 `SKILL.md`。当 `customSkillDirs` 指向该目录时，提供方 `dsh-skill-filesystem` 会发现目录并在 `ctx.skills` 上注册 Skill。

## 文件

- `SKILL.md`：Skill 本身。Frontmatter 携带 `name` 和 `description`；正文是模型可见内容。
- `cordis.patch.yml`：将目录连接到文件系统 Skill 提供方的 patch overlay。

## 命名

`hello-scenario` 是占位符。将目录重命名为场景的 kebab-case 名称（不能以数字开头，不含点或下划线），并同步更新 frontmatter `name:`。提供方会对不匹配情况发出警告，并从目录中删除该 Skill。

## 挂载

模板的 `cordis.patch.yml` 挂载 `dsh-skill-filesystem`，设置 `includeDefaultRoots: false`，并让 `customSkillDirs` 指向包含此 Skill 的目录。使用以下命令应用 patch：

```sh
pnpm dsh --profile headless --patch docs/ops/templates/skill/cordis.patch.yml "..."
```

随后，该 Skill 会通过 `dsh-tool-skill` 出现在模型可见目录中；`user-invocable` 保持默认值 `true` 时，它也会出现在用户可见的命令面板中。

## 验证

启动应用 patch 的 profile，并要求模型按名称加载 Skill。提供方每次调用时都会重新读取 `SKILL.md`，因此 frontmatter 和正文修改无需重启 harness 即可生效。

## 边界

Skill 只发布提示词内容。副作用由外围模型轮次承载。Skill 不声明风险或批准；同一轮次中 Skill 正文之后的所有工具调用由父级批准链控制。

需要自己的会话、自己的工具集，或者需要让父级读取一次最终 assistant 文本的场景，应改用 [Subagent 模板](../subagent/README.zh.md)。

Skill 与 Subagent 的边界规则、manifest 字段和生命周期义务见[场景集成约定](../../scenario-integration-contract.zh.md)。
