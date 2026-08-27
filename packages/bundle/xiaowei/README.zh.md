# `@deepseek-ai/dsh-xiaowei`

[English](README.md) | 中文

小薇多用户 profile bundle 在共享基础组合之上叠加账户认证、按 owner 隔离的 workspace 根目录、钱包与模型密钥存储、产物、搜索提供方和远程桌面载体。账户根目录由 `XIAOWEI_ACCOUNT_WORKSPACE_ROOT`（或 `DSH_HOME/account-workspaces`）及账户 ID 的 SHA-256 派生；同宿主 shell、原始文件系统、workflow 和委托执行工具保持禁用。

当账户 Skill 存储存在时，小薇安全 Agent 组合会挂载 `skill_install` 工具。一次成功的问答式安装会在不透明的账户哈希目录下写入一个 `SKILL.md`，并刷新 Skill 注册表供下一次查找使用。客户端不能选择服务器模块、activation id、文件系统路径、配置正文或账户 ID；所有所属关系都来自认证 principal，以及为该 principal 创建的 Session header。

同一组合独立于 Session 的对话模型暴露 `web_search` 与 `web_fetch`。搜索使用 Firecrawl，并在缺少凭据时回退到回环 SearXNG。抓取首先使用固定 DNS 公网地址的 HTTP provider，只在安全取得 HTTP 403 或 429 响应后才尝试 Firecrawl；因此读取普通公开页面与 raw 文件不要求 Firecrawl 凭据。

## 模型体验

### 已安装账户能力

#### 模型看到的内容

该 bundle 自身不贡献模型可见文本。它的 preset 暴露稳定的 Web 工具 schema，宿主选定的 provider 不会随对话模型改变。挂载的插件 activator 可以向新建账号 Session 增加工具；恢复与 fork 会保留该 Session 已记录的选择。`skill_install` 提供允许模型持久化用户认可 Skill 的工具 schema。只有后续 Skill 查找与调用路径选中已安装内容时，该内容才会进入模型请求。

#### Token 影响

取决于已安装的插件工具，以及后续请求选中的账户 Skill；该 bundle 自身不贡献提示词 token。

#### KV Cache 影响

插件选择可以改变后续 Agent 实例的工具 schema 前缀。安装 Skill 不会改写正在执行的请求；后续选中该 Skill 时，存储的指令才可能加入该次请求上下文。

## 已知限制与暂缓事项

- 插件选择不会热重组已有 Session；账号当前选择只在新建 Session 时读取，恢复与 fork 使用 Session 已记录选择。
- 插件目录与 activator 属于部署代码，不是远程市场 feed。
- 小薇当前只发布部署安全的 `core-tools` 目录项。通用可选插件机制仍可供其他部署使用；在账户隔离的宿主执行能力就绪前，小薇不发布宿主执行 activator。
- 账户 Skill 只存在于一个小薇宿主。复制、版本历史、审核流程与跨设备同步尚未实现。
- 委派的子 Agent 当前继承 preset 组合，不继承挂在父 Agent 精确 scope 上的可选 activator。
