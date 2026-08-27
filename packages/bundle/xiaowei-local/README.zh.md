# @deepseek-ai/dsh-xiaowei-local

[English](README.md) | 中文

小薇设备运行时由精确的 Host 依赖清单与本组合包构成。它把桌面端监管的 Host 绑定到操作系统分配的回环端口，并且只公开 `xiaowei-local-safe` preset。该 preset 包含限制在 workspace 内的文件系统与搜索工具、限定在 workspace 内的 Shell 执行、后台任务、联网搜索、工作流、进程内子智能体、Skill 加载以及受审批保护的本机 Skill 安装。

用户选择的目录会保持为实时 workspace；打开目录不会把它转为云端副本导入，也不受上传大小限制。模型设置、凭证、Session、Workspace 元数据、Worker 进程和已安装 Skill 都保留在本机 Harness home 中。云端环境仍是独立 Host，创建云端副本必须由用户在桌面端显式触发。用户有意加入模型请求的内容仍会发送给所配置的模型提供方。

## 模型体验

### 设备本机能力

#### 模型可见内容

模型只会看到 `xiaowei-local-safe` preset 及其本机 Worker 工具 schema。文件系统工具和 Shell 默认在选定 workspace 内工作，并强制执行其 sandbox 策略。工作流和子智能体 provider 在设备端运行。`skill_install` 调用会说明拟安装的 Skill，并在将其原子发布到设备本机 Harness home 前等待用户批准；只有后续请求通过 Skill 查找与调用选中它时，已安装指令才会进入模型上下文。

#### Token 影响

本机 Worker 工具 schema 构成稳定的请求前缀。已安装 Skill 的内容取决于数据，并且只在后续请求选中该 Skill 时贡献 token。

#### KV Cache 影响

对同一 Agent 实例，本机 preset 的工具 schema 前缀保持稳定。安装 Skill 不会改写当前请求；后续选中该 Skill 时，保存的指令可能加入上下文并改变该次请求。

## 已知限制与暂缓事项

- 本机模式不消耗账号钱包余额；用户必须在本机运行时中配置模型提供方。
- 桌面端 Host 不可用时，本机 Session 无法继续运行；需要服务端持续执行的工作应使用独立的云端环境。
- 设备安装包只包含本机运行闭包；账号、钱包、云端 Skill 商店、云端 Workspace 存储、Web renderer、E2B 和遥测包均不进入该闭包。
