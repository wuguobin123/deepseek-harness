---
sdd:
  id: feature.xiaowei.account-extension-installation
  kind: feature
  status: implemented
  owners:
    - xiaowei-platform
  requirements:
    - id: REQ-xiaowei-account-extension-installation-001
      text: Deployment-owned default plugins are active and immutable for every authenticated account, while optional plugin selections are isolated by account.
    - id: REQ-xiaowei-account-extension-installation-002
      text: Plugin installation requests derive the account from the authenticated principal, accept only a deployment-owned plugin id, and affect only sessions created after the selection changes.
    - id: REQ-xiaowei-account-extension-installation-003
      text: Each Session records the plugin selection used to compose its model-visible tools, and restoration or forks preserve that recorded selection instead of reading mutable account installation state.
    - id: REQ-xiaowei-account-extension-installation-004
      text: Conversational Skill installation derives ownership from the durable Session owner, requires one-shot user approval, writes only to that account's private Skill root, and becomes discoverable only to that account.
    - id: REQ-xiaowei-account-extension-installation-005
      text: The authenticated client distinguishes immutable defaults from optional plugins and reports that selection changes apply to new sessions.
    - id: REQ-xiaowei-account-extension-installation-006
      text: A valid account bearer remains the authenticated principal for ordinary loopback RPCs so desktop-created Sessions record the signed-in account owner, while bearer-free requests and host-machine management methods retain local identity.
  acceptance:
    - id: ACC-xiaowei-account-extension-installation-001
      text: An assembled Xiaowei runtime activates the safe default catalog entry for two accounts, rejects an unavailable host-execution plugin, and keeps account Skill installation isolated.
      evidence:
        - packages/account/plugin-factory/tests/plugin-factory.spec.ts
        - apps/cli/tests/web-agent-presets.e2e.ts
    - id: ACC-xiaowei-account-extension-installation-002
      text: New sessions record their resolved plugin ids, and restoration and fork checks use that record after account installation state changes.
      evidence:
        - packages/account/plugin-factory/tests/plugin-factory.spec.ts
        - packages/host/apiproxy/tests/api-proxy-account-plugins.spec.ts
        - packages/sdk/client/tests/sdk-client.spec.ts
        - python/sdk/tests/test_client.py
    - id: ACC-xiaowei-account-extension-installation-003
      text: Plugin RPC checks prove principal-derived ownership, system-default immutability, idempotency, and omission of activation ids, account ids, module names, and server paths from the wire response.
      evidence:
        - packages/host/apiproxy/tests/api-proxy-account-plugins.spec.ts
    - id: ACC-xiaowei-account-extension-installation-004
      text: An assembled Xiaowei account installs an approved Skill and discovers it on the next lookup, while another account cannot discover it.
      evidence:
        - apps/cli/tests/web-agent-presets.e2e.ts
    - id: ACC-xiaowei-account-extension-installation-005
      text: Focused checks reject anonymous and subagent installation before approval, reject unavailable or disabled approval without writes, and refuse unsafe Skill filesystem targets.
      evidence:
        - packages/account/tool-skill-install/tests/tool-skill-install.spec.ts
        - packages/account/skill-store/tests/skill-store.spec.ts
        - packages/skill/skill-filesystem/tests/skill-filesystem.spec.ts
    - id: ACC-xiaowei-account-extension-installation-006
      text: The authenticated settings page lists defaults and optional plugins, performs install and uninstall through the typed client API, and displays the new-session activation rule.
      evidence:
        - packages/client/ui-settings-plugin-inventory/tests/browser-plugin.client.spec.tsx
        - packages/client/ui-settings-plugin-inventory/tests/components.client.spec.tsx
    - id: ACC-xiaowei-account-extension-installation-007
      text: The loopback carrier preserves a valid account bearer for an account RPC and keeps bearer-free requests and host-machine management methods on the local principal.
      evidence:
        - packages/client/connection/tests/node-half.host.spec.ts
  evidence:
    - packages/account/plugin-factory/src/index.ts
    - packages/host/apiproxy/src/api-proxy.ts
    - packages/account/tool-skill-install/src/index.ts
    - packages/account/skill-store/src/index.ts
    - packages/client/ui-settings-plugin-inventory/src/client/PluginFactorySettingsTab.tsx
    - apps/cli/tests/web-agent-presets.e2e.ts
  decisions:
    - .agents/notes/implemented/architecture/2026-08-26-account-scoped-plugin-and-skill-installation.md
    - docs/architecture.md
---
# 小薇账号扩展安装

[English](account-extension-installation.md) | 中文

该功能为每个已登录的小薇账号提供隔离的扩展状态，同时让所有账号都能直接使用部署默认项。插件工厂与对话式 Skill 安装是两条独立产品路径，并共用一条由服务端派生归属的规则。小薇当前交付的目录只包含安全的 `core-tools` 默认项；通用可选插件机制仍可用，但在宿主执行能力具备账户隔离前，小薇不发布宿主执行 activator。

## 运行时规则

部署方拥有插件代码、目录元数据与激活函数。账号请求只能选择目录中的 `pluginId`，不能提供账号 ID、activation id、模块名、配置对象或服务端路径。默认目录项无需账号记录便保持激活；部署发布可选项时，其记录按认证账号区分。小薇产品目录当前刻意不包含可选宿主执行项。

每个 Session 都会记录其工具组合使用的插件 ID。账号安装状态变更只影响后续 Session，不会在进程恢复或 fork 后改变已有 Session。

`skill_install` 工具接受 Skill 内容，但不接受归属或路径字段。持久 Session owner 选择账号根目录；标准审批服务必须批准本次写入，存储才会发布 `SKILL.md` 并刷新发现结果。

即使 Host 是 loopback，桌面载体也会在普通 RPC 中把有效账号 Bearer 保留为请求 principal；不携带有效 Bearer 的 loopback 请求仍使用本机管理 principal，作用于宿主机器的方法即使随桌面账号 token 发出也继续保留该本机 principal。这样，已认证桌面 Session 能记录账号 owner，同时不移除本机管理和原生宿主操作。

## 验证

验收证据组合服务测试、认证 RPC 测试、客户端组件测试、Session 回放检查、SDK 事件投影与随发行版交付的小薇组合。以上每个验收 ID 都指向其声明层级的证据。
