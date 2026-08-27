# @deepseek-ai/dsh-account-plugin-factory

[English](README.md) | 中文

服务端拥有的插件目录与按账号保存的安装状态。目录条目把公开的 `pluginId` 映射到预注册激活器；客户端不能提交模块名、文件系统路径或配置正文。SQLite 只保存以 `(user_id, plugin_id)` 为键的可选安装记录。系统默认条目始终启用，不能卸载。

创建新 Session 时，Host 只读取一次认证账号的可选项，将其记录为 `account-plugins/selected`，并把同一份快照交给 `mountAccountPlugins()`。冷恢复与 fork 从该 Session 事件挂载，不再读取可变账号状态。缺少该事件的旧 Session 只获得当前系统默认项。内置目录包含系统默认的基础能力条目与可选的精确编辑器。

## 模型体验

### 已激活能力

#### 模型看到的内容

已安装的激活器可以向该账号后续创建的 Agent 作用域增加 `str_replace_editor` 等模型工具。工厂自身不增加提示词或工具 schema。

#### Token 影响

取决于已安装激活器；工厂自身不贡献 token。

#### KV Cache 影响

安装选择变化可能改变后续 Agent 实例的工具 schema，因而改变其缓存前缀；不会修改正在运行的实例。

## 已知限制与暂缓事项

- 目录与激活器来自部署代码，不是远程插件市场数据源。
- 安装变化只影响之后创建的 Session；已有、恢复和 fork 的 Session 保留各自记录的选择。
- 委派的子 Agent 继承 preset 组合，不继承挂在父 Agent 精确 scope 上的可选 activator。
- SQLite 记录所选插件 id；尚未实现目录版本迁移策略。
