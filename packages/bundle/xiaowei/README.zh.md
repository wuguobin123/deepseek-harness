# `@deepseek-ai/dsh-xiaowei`

[English](README.md) | 中文

小薇多用户 profile bundle 在共享基础组合之上叠加账户认证、按 owner 隔离的 workspace 根目录、钱包与模型密钥存储、产物、搜索提供方和远程桌面载体。账户根目录由 `XIAOWEI_ACCOUNT_WORKSPACE_ROOT`（或 `DSH_HOME/account-workspaces`）及账户 ID 的 SHA-256 派生；同宿主 shell、原始文件系统、workflow 和委托执行工具保持禁用。

当账户 Skill 存储存在时，小薇安全 Agent 组合会挂载 `skill_install` 工具。一次成功的问答式安装会在不透明的账户哈希目录下写入一个 `SKILL.md`，并刷新 Skill 注册表供下一次查找使用。客户端不能选择服务器模块、activation id、文件系统路径、配置正文或账户 ID；所有所属关系都来自认证 principal，以及为该 principal 创建的 Session header。

同一组合独立于 Session 的对话模型暴露 `web_search` 与 `web_fetch`。搜索使用 Firecrawl，并在缺少凭据时回退到回环 SearXNG。抓取首先使用固定 DNS 公网地址的 HTTP provider，只在安全取得 HTTP 403 或 429 响应后才尝试 Firecrawl；因此读取普通公开页面与 raw 文件不要求 Firecrawl 凭据。

## 业务 Skill 热加载

平台只需部署一次业务 Skill 运行时。此后，已登录账户可在“设置 → 插件 → 业务 Skills”中校验、发布、停用或回滚纯数据 manifest，无需修改平台源代码或重启服务。发布会原子创建不可变版本、切换活动指针，并刷新下一模型步骤使用的 Skill 目录；校验失败或版本冲突时继续使用上一正常版本。

部署侧通过 `XIAOWEI_BUSINESS_SKILL_HOSTS` 和 `XIAOWEI_BUSINESS_SKILL_CREDENTIAL_REFS` 设置允许列表。manifest 只能选择允许主机上的 HTTPS URL，以及该连接器允许的凭据引用。凭据值在每次操作时解析，不进入 manifest、浏览器响应、模型参数或审计事件。增加全新的信任域或凭据引用属于运维安全策略变更；已允许域名上的普通业务 Skill 均可纯配置热接入。

小薇指标端点使用 `XIAOWEI_BUSINESS_API_CREDENTIAL_REF` 选择服务端凭据，使用 `XIAOWEI_BUSINESS_METRICS_GRANTS` 保存从认证用户 ID 到权限数组的 JSON 对象。`XIAOWEI_BUSINESS_SKILL_RETRIES` 将连接器重试次数设为零至五；服务端把每次允许或拒绝的指标决策写入 `DSH_HOME` 下的 `business-metrics-audit.jsonl`。授权映射属于部署策略，客户端和 manifest 不能把自己加入授权，也不能提供身份字段。

所有 manifest 和工具输入都会递归拒绝 `userId` 与 `tenantId`。工具只接受 `skill`、`operation` 和业务 `input`；运行时从认证 Session 派生 `userId`，并通过 `X-Xiaowei-User-Id` 传给业务 API。业务 API 先校验连接器 Bearer 凭据，再针对该可信用户校验 `X-Xiaowei-Required-Permission`，通过后才查询数据。小薇当前没有权威的租户成员选择，因此本版本不会虚构或接收 `tenantId`，也不会发送该字段。

```yaml
name: xiaowei-metrics
version: 1.0.0
description: Query registered-account and share-code usage totals.
connectionIds:
  - https://business.example.com/api/
credentialRefs:
  - XIAOWEI_BUSINESS_API_TOKEN
operations:
  - id: registered-accounts
    method: GET
    path: /metrics/registered-accounts
    input: { type: object, additionalProperties: false }
    output: { type: object, properties: { count: { type: integer }, observedAt: { type: string } }, required: [count, observedAt], additionalProperties: false }
    permission: metrics.accounts.read
    connection: https://business.example.com/api/
    credentialRef: XIAOWEI_BUSINESS_API_TOKEN
    risk: R1
  - id: share-code-usage
    method: GET
    path: /metrics/share-code-usage
    input: { type: object, additionalProperties: false }
    output: { type: object, properties: { count: { type: integer }, observedAt: { type: string } }, required: [count, observedAt], additionalProperties: false }
    permission: metrics.share-codes.read
    connection: https://business.example.com/api/
    credentialRef: XIAOWEI_BUSINESS_API_TOKEN
    risk: R1
```

`tool-capabilities` export 是发布版本地与云端 preset 的机器可读 manifest（元数据清单）。它列出共享工具、位置专属工具及允许的位置感知描述。装配后的 profile 测试会读取已注册定义，并比较每项共享工具的输入和输出 schema、超时、展示回调及并发分类；未声明的差异会被拒绝。只有 manifest 明确声明时，位置感知描述才可以不同，让模型能够判断持久化数据属于本机还是账户。

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
- 业务 Skill 当前只支持只读 `GET` 操作。写操作、用户 OAuth 与租户身份会在相应授权和审批协议实现前保持关闭。
