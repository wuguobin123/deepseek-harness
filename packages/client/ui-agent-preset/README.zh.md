# dsh-client-ui-agent-preset

[English](README.md) | 中文

agent preset UI 包含两个位置：General 设置中的一行，用于选择后续新建会话使用的 [preset](../../preset/agent-presets/README.zh.md)；以及会话标题旁的一个只读标签。

## 为什么它是"新建会话"的偏好设置

会话的 preset 在创建时即固定——宿主拒绝以不同 preset 接管已存在的会话，因为该会话的历史是在最初那份 preset 的工具下产生的。General 行修改后续会话的默认值；运行中的会话保持它们开始时的组装。

## 新建会话界面

新建会话界面不渲染 preset 选择器。启动会话时使用宿主报告的有效默认值，因此 preset 选择是持久设置，而不是新建会话页上的临时状态。

## 会话标题旁的标签

会话标题旁会显示**本会话**所运行的 preset，并作为静态装饰呈现。在那里放一个控件，等于承诺一次宿主会断然拒绝的切换。它从会话自身的摘要读取 preset，并在 General 行所读的同一份名单上解析显示名称。转发的 owner 事件 `agent-preset/selected` 会在每个标签页中把已经提交的空会话切换折进这份共享摘要；发起方标签页可能已经采用 RPC 回执，而合并是幂等的。

## 它读什么、写什么

选项与当前默认值都来自同一次 `agentPreset.list` 调用。名单本身已经报告了"未显式选择的会话会得到哪个 id"，因此本行无需对 settings schema 做内省；写入目标是 `agent-presets` settings 命名空间的 `default` 字段，也正是宿主在创建时解析的那个字段。

本地创作的 preset 的权限恰好等于它所引用的插件，因此列表会标注 `user` 行，而不是把每个 preset 都呈现为随附且已审核的。

preset 文件提供一套未国际化的 `name` 与 `description`，Web 将其用于所有 `user` 行和未知的 `system` 行。对于四个随附 id（`standard`、`code`、`minimal` 与 `cordis`），只有名单将该行标记为 `system` 时，Web 才会从当前 locale 解析这两个字段；同名的 `user` preset 仍使用其文件元数据。

本行在自身命名空间的 `settings/changed` 以及 `connection/reset` 时重新读取：名单是一个活动目录，默认值是一项设置，外部编辑与重新连接都可能改变它。

## 何时不显示这些表层

未组装任何 preset 的部署返回空名单，本行与标签都不渲染任何内容。此时每个会话共用宿主组装，也就无从选择或显示。

## 模型体验

Indirectly, through the preset a later session is composed from; [`dsh-agent-presets`](../../preset/agent-presets/README.zh.md) owns what that composition puts in front of the model.

#### KV Cache effect

没有直接的失效影响。更改默认值绝不触及运行中会话的前缀；此后创建的会话依据它自己的组装建立自己的前缀。

## 已知限制与暂缓事项

- **没有元数据的 preset 按 id 列出** —— 展示文本是可选的，未取名的副本刻意回退到目录名，而不是与其来源呈现得一模一样。
