# Agent Note: 损坏的 preset 是名单行，不是空缺

Status: implemented

[English](2026-08-09-broken-preset-roster-rows.md) | 中文

## 问题

文件成为唯一的组装编辑器之后，手动编辑造成的损坏有两种形态，且都要拖到最糟的时刻才暴露。`agent.cordis.yml` 解析不了的 preset 在名单上是一张完全正常的行——可选择、可复制、可设为默认——直到下一个会话尝试挂载才失败；一旦被设为默认，所有新会话都无法启动。组装文件被整个删掉的目录则从名单上消失，却仍在磁盘上占着它的 id：`copy` 以「先删除既有 preset」拒绝这个名字，`remove` 却回答「找不到」——两条互相矛盾的错误，除了手动删目录别无出路。

## 决定

发现过程负责健康，受损目录是**携带 `broken` 原因的名单行**，绝不是空缺。`scanRoot` 把名字是可用 preset id 的每个目录都当作一个 preset 槽位：组装缺失 → broken（「仍占着该 id；删除目录或恢复文件」），组装不可读/解析失败/不是具名行列表 → broken 并携带解析器的首行。形状检查用加载器自己的 `entryListSchema`（含 `!!js` 的方言）解析，因此健康检查绝不会把加载器接受的组装叫作损坏；名字不符合 `PRESET_ID` 的目录直接跳过，因为复制永远不可能与之相撞。`broken` 依次落在 `AgentPreset` 与 `agentPreset.list` 的线上条目上。挂载路径（`mount`/`recompose`/`standingKeyFor`）经 `resolveMountable` 用发现时记下的原因在前置拒绝；`resolve` 照样应答，因为创作调用方需要读取、修复、上报或删除这个已占用 id，而 `copy` 的名单检查能看见该冲突。

General 客户端选择器经 `presetOptions` 完全不列出损坏的 preset。它选择后续会话的默认组装，提供无法组装的选项只会推迟失败。创作 agent 和服务客户端读取完整名单，包括原因和已占用 id。

## 后果

- 幽灵死路在创作服务中消除：目录以损坏行列出，`remove` 清掉目录，释放的 id 立刻可用（包测试与 CLI e2e 覆盖）。
- 事后才损坏的默认值仍会在会话启动处大声失败——选择器隐藏损坏行，但没有任何东西改写已存的默认；`resolveMountable` 的前置拒绝让每种不可加载形态得到同一条消息，而不是依赖加载器内部的报错。
- 健康检查随每次 `list()` 运行：每次读名单对每个 preset 一次读取加解析，接受的理由与不做缓存的发现相同——名单很小，新鲜是契约。
- `copy` 保持形状无关。调用方可以复制损坏来源，副本仍是挂载路径会拒绝的损坏名单行；修复或删除才是有效的创作操作。

## 关键细节

- **`PRESET_ID` 移到 `types.ts`**，让发现与创作共享同一份包含边界词汇；authoring 原样转发导出。
- **原因只留一行。** js-yaml 会附上多行代码框摘录；`compositionProblem` 为每个名单消费者保留简洁的 wire 诊断。
- **mount.spec 的两个竞态用例特意不动**：`ensureStanding` 仍可能拿到删除前一刻解析出的 preset（私有路径测试），其 stamp/unstampable 语义不变——健康检查发生在此之前的公开路径上。
- **创造模式引导负责修复。** `cordis` preset 的 persona 禁止编辑随附安装，并把创作指向 `${DSH_HOME:-$HOME/.dsh}/.agent-presets/<id>/`；其技能讲解元信息、先复制再改的流程，以及[通过 `standingKeyFor` 挂载校验](2026-08-11-preset-authoring-agent-validates-its-own-composition.zh.md)。

## 曾考虑的替代方案

发现时省略损坏目录、只在复制时用更好的报错拒绝该 id：创作调用方仍没有可修复或删除的名单行。深度校验（读名单时解析每一行的模块）：挂载已经拥有这一失败并带回滚，每次读名单逐行 import 既不便宜也不更可操作。阻止 `settings` 写入指向损坏默认值：settings 领域是通用的，而名单是活目录——此刻缺失或损坏的名字到下一个会话可能已经有效，挂载的响亮失败才是拥有那一刻的强制点。
