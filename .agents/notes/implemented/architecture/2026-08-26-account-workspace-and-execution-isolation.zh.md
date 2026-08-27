# Agent Note: 账号工作区与执行隔离

Status: implemented

[English](2026-08-26-account-workspace-and-execution-isolation.md) | 中文

## Problem

Session owner 可以阻止一个账号读取另一个账号的对话，但 Workspace 只标识一个宿主路径。认证账号可以提交路径或 Workspace ID 来选择宿主可读文件，而所有沙箱模式都允许本机文件系统读取。因此，与宿主共享的 shell 和 workflow 会让账号隔离取决于调用方选择的路径，而不是该账号拥有的执行环境。

## Decision

每个 Workspace 都带有持久 owner：一个认证账号或本机管理身份。Workspace 注册表的读写操作接收访问身份，账号 RPC 只能从认证 principal 派生该身份，未知和其他账号的 Workspace ID 返回相同的 not-found 结果。Workspace 领域版本 3 要求 owner 字段。注册表在挂载 Session ID 前校验 Session cwd 和 Session owner，并对冷持久 Session 保持这些校验。

API 网关在部署存储下根据认证用户 ID 的哈希值派生账号根目录。账号创建 Session 时拒绝调用方提供的 `cwd`，在该根目录下创建或选择 Workspace，并在路径规范化和符号链接解析后校验目录浏览与创建。账号响应会让 home 和面包屑投影止于私有根目录，拒绝原生目录选择与宿主路径打开，并按持久 owner 限定 Workspace 事件和已归档 Session ID。本机调用保留现有的宿主路径操作。

小薇会显式配置唯一账号 preset。网关只有在该 preset 及其目录都可用时才创建账号 Session，不会在目录缺失时回退；账号目录只展示该 preset，并禁止账号选择或编写 preset。该 preset 包含文档、电子表格、演示文稿、图表、HTML 产物、Skill、联网搜索、目标、计划、用户提问和 todo 能力，并移除与宿主共享的 shell、原始文件系统、workflow、后台任务和委派执行工具。在可选 activator 进入账号隔离运行时前，小薇插件目录同样只发布安全的系统默认项。

本次更改采用预发布格式切换。首次发布带 Workspace owner 的小薇时，启动前会先备份并清除历史 Session 和 Workspace 介质，不执行迁移。运行时拒绝旧 Workspace 介质，绝不会把含糊的路径或对话分配给第一个看到它的账号。

## Verification

Workspace 测试覆盖持久 owner 校验、按 owner 查找和排序、挂载时 Session owner 校验、冷 Session 投影、领域版本拒绝及缓存与表不变量。API 测试覆盖两个账号根目录、其他账号的 Workspace ID、调用方提供的 cwd、目录逃逸、宿主能力拒绝、事件投递隔离与账号 preset 强制执行。客户端测试证明连接 Workspace 时只发送 Workspace ID。小薇组装测试证明账号安全工具清单、不可用宿主执行插件的拒绝和账号私有 Skill 安装。

## Alternatives considered

**只在 Session API 授权。** 调用方仍可在 Session 获得 owner 前选择其他宿主目录，因此只有 Session owner 不能保护文件。

**保留宿主工具并依赖 `workspace-write`。** 该策略允许所有读取，也不是进程或内核隔离机制，无法阻止 shell 命令、workflow worker 或文件系统工具泄露数据。

**迁移或分配历史记录。** 历史 Workspace 可能混合多个 Session，也可能缺少明确账号 owner。本预发布部署没有兼容性承诺，因此先备份再清除比编造权限归属更安全。

## Consequences

认证用户保留通过 owner-aware 服务工作的基础探索与办公产物能力，但暂时不能使用本地编码、shell、workflow 或委派能力。只有当执行提供方的文件系统、子进程、spill、终端、workflow 与子 agent 资源都继承相同账号根目录和 owner 后，才能恢复这些能力。发布验收必须分别证明备份、历史介质清理、安装客户端行为和生产部署。
