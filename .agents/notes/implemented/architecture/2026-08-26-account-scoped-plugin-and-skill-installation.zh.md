# Agent Note: 按账号隔离的插件与 Skill 安装

Status: implemented

[English](2026-08-26-account-scoped-plugin-and-skill-installation.md) | 中文

## 问题

OpenAI 将插件定义为包含 Skill、MCP 服务与可选 UI 的共享可安装代码。安装和启用操作为账号或工作区选择该代码包，而不是为每个对话复制可执行代码。工作区可用性、插件包含关系、连接器授权、操作权限与运行时权限是互相独立的控制项。Skill 也分别保留系统、管理员、用户与仓库根目录；安装插件不会授予连接器访问令牌。这些分层见 [插件](https://developers.openai.com/plugins/concepts/plugins)、[插件控制](https://learn.chatgpt.com/docs/enterprise/apps-and-connectors) 与 [Skill](https://learn.chatgpt.com/docs/enterprise/skills)。

WorkBuddy 组合挂载固定的 Cordis 插件集合，并通过只读清单投影 Loader 条目。其账号安全机制把认证 principal 写入带品牌类型的 Session owner，在 fork 与子智能体中继承该 owner，由服务端按 owner 过滤 Session 操作，并在客户端切换账号前停止旧数据流。这套机制提供账号与 Session 隔离，但没有定义按账号保存的插件安装状态。

小薇组合两类模型中可复用的机制：部署方拥有的共享插件代码、显式账号安装记录、服务端 Session 归属、账号私有 Skill 存储，以及对话式持久安装的独立用户审批。

## 决策

小薇提供两种安装机制，并遵循同一归属规则：由认证 principal 选择账号，浏览器或模型 payload 都不能提供账号 id 或服务端路径。插件工厂按 `(user_id, plugin_id)` 保存可选项，并通过服务端拥有的预注册激活器目录解析 `pluginId`。对话式 Skill 安装从持久 Session header 派生 owner，只写入该 owner 的哈希账号目录。

对于普通 RPC，载体会先解析有效账号 Bearer，再分配 loopback 的本机管理 principal。因此，已登录的 Electron 客户端在 loopback 上创建 Session 时仍保留账号 principal，并把该账号写入新 Session header；不携带 Bearer 的 loopback 请求继续作为本机管理请求。作用于宿主机器的方法在携带账号 token 时也保留本机 principal，使原生操作和管理工具无需冒充账号。

系统默认插件仍属于部署组合，在目录中表现为已安装且不可变，不创建账号记录。新账号 Session 在必需的 `account-plugins/selected` 日志事件中快照可选插件 id，空选择也会记录；同一快照用于组装新 Agent。安装变化只影响之后创建的 Session，冷恢复与普通 fork 从已记录事件组装，不读取可变账号状态。缺少该事件的旧 Session 只获得当前系统默认项。委派的子 Agent 继承其 preset 组合；挂在父 Agent 精确 scope 上的可选 activator 不会传播给子 Agent。

## 插件工厂

`account.plugins.list`、`account.plugins.install` 与 `account.plugins.uninstall` 从 `request.principal` 派生 `userId`。线上的返回值省略激活器 id 与存储细节。SQLite 只保留账号 id、插件 id 与安装时间。未知 id 会失败；系统默认项不能卸载；重复安装和卸载均为幂等操作。

可安装目录条目引用服务端注册的激活器，而不是模块路径。创建新 Session 时，Host 只读取一次账号选择，并将同一个有序插件 id 数组用于 Session 事件与激活；恢复与 fork 时，`mountAccountPlugins()` 在 Agent 发布前从 Session 事件解析激活器。未知或无效的持久 id 会使恢复明确失败，不会静默改变工具集。激活器 effect 落入精确 Agent 作用域，因此客户端不能提交可执行配置，某个账号的可选工具也不会进入全局注册层。

## Skill 安装

`skill_install` 接受 `name`、`description` 与 `instructions`。没有 owner 的会话与子智能体会在提示用户前被拒绝。每次符合条件的提议调用都会在执行前进入标准的一次性审批服务；用户拒绝、审批不可用与 `never` 策略都会关闭式失败，不产生写入。存储使用 SHA-256 哈希 owner id，并以私有权限、受限输入、符号链接拒绝、同文件系统暂存、文件同步与原子重命名写入 `<dshHome>/accounts/<hash>/skills/<name>/SKILL.md`。相同内容重复写入是幂等的；同名不同内容会冲突。

账号感知的 Skill 查询只包含配置的系统根目录、内置根目录与匹配的账号根目录，并排除项目根目录和共享用户根目录。`ownerId` 参与注册表缓存键；安装成功后调用 `ctx.skills.refresh()`，使下一次查询能看到新 Skill。模型结果只暴露 `{ name, changed }`。

## 客户端行为

现有设置标签页有两种模式。Loopback 保留只读 Loader 诊断；认证远程模式展示账号目录，标记系统默认项，并为可选条目提供安装或卸载操作。页面会说明新会话生效规则。

## 验证

通用插件工厂的聚焦测试覆盖账号记录隔离、系统默认激活与不可变、未知目录配置、按 Agent 作用域隔离工具、Session 选择快照、卸载后的 fork 保留、从 principal 派生 RPC 归属、loopback Bearer 保留、线上字段脱敏、账号目录分离、原子且幂等的 Skill 写入、符号链接拒绝、审批通过与拒绝、匿名与子智能体拒绝、注册表立即刷新、账号感知文件系统发现，以及设置页的两种模式。小薇整装检查证明产品目录只发布 `core-tools` 默认项，拒绝不可用的宿主执行 `precise-editor` ID，并通过真实审批 mux 完成 `skill_install` 后检查两个账号视图。

桌面端发布验收要求四个平台安装包全部就绪后才能发布。服务器与 COS 先接收带版本号的对象，再更新稳定别名，最后发布 `latest.json`，确保客户端看到清单时其中每个 URL 都已经可用。

## 已考虑的替代方案

**把插件代码复制到每个账号目录。** 这会重复部署方拥有的可执行代码，使升级复杂化，并让完整性依赖各账号文件。共享目录代码加账号选择记录可以让版本与激活继续由部署方控制。

**允许客户端或模型提供账号 id 与安装路径。** 这会让归属隔离依赖调用方自律。认证 principal 与持久 Session owner 仍是唯一账号选择器，所有存储路径均由服务端派生。

**把默认插件与可选插件视为相同的可变安装记录。** 这会允许账号删除部署必需行为。默认项保持不可变组合，只有可选目录条目创建账号记录。

**从账号当前状态重组已有 Session。** 该 Session 的历史由已记录工具集产生，因此在实时运行、恢复或 fork 时改变组合都会削弱回放一致性。可选安装变化只影响之后创建的 Session。

## 后果

增加插件市场条目时，部署代码必须注册其激活器与公开目录元数据。小薇当前不发布任何可选目录项；通用账号选择生命周期保留给未来通过安全评审的激活器。现有共享本地 Skill 不会自动归属远程账号，必须明确安装到对应账号。运行中插件热重组与 Skill 更新／删除仍是独立的后续生命周期工作。

按工作区角色控制可用性、签名市场包与版本分发、连接器 OAuth 授权、按操作授权和安装审计历史仍是独立生命周期层。后续增加这些能力时，不得把可执行包分发、账号选择、外部服务凭证与运行时权限决策合并为一条记录。
