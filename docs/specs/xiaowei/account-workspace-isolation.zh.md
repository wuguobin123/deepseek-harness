---
sdd:
  id: feature.xiaowei.account-workspace-isolation
  kind: feature
  status: implemented
  owners:
    - xiaowei-platform
  requirements:
    - id: REQ-xiaowei-account-workspace-isolation-001
      text: Every authenticated account workspace has a durable server-derived owner, and workspace reads and mutations reveal or change only records owned by that principal.
    - id: REQ-xiaowei-account-workspace-isolation-002
      text: An authenticated account cannot select an arbitrary host cwd; new Sessions use either an owned workspace or that account's private server-derived workspace root.
    - id: REQ-xiaowei-account-workspace-isolation-003
      text: Remote directory listing and creation stay within the authenticated account's private root after canonical path and symlink resolution, while the local management principal retains host directory access.
    - id: REQ-xiaowei-account-workspace-isolation-004
      text: Xiaowei does not expose host filesystem, shell, subprocess, or workflow execution to authenticated accounts until those operations execute inside an account-confined runtime.
    - id: REQ-xiaowei-account-workspace-isolation-005
      text: The first Xiaowei release with account workspace ownership backs up and clears historical Session and Workspace media instead of assigning ambiguous pre-change records to an account, and the runtime rejects old Workspace domain media.
  acceptance:
    - id: ACC-xiaowei-account-workspace-isolation-001
      text: Two authenticated accounts can create same-named workspace directories under separate roots and cannot list, open, rename, delete, reorder, attach, or create a Session from the other account's workspace id.
      evidence:
        - packages/workspace/workspace/tests/workspace.spec.ts
        - packages/host/apiproxy/tests/api-proxy-workspace.spec.ts
    - id: ACC-xiaowei-account-workspace-isolation-002
      text: Authenticated Session creation rejects a client cwd and uses a server-derived account root when no workspace id is supplied, while local Session creation retains its existing cwd behavior.
      evidence:
        - packages/host/apiproxy/tests/api-proxy-workspace.spec.ts
        - packages/client/runtime/tests/workspaces-service.client.spec.ts
    - id: ACC-xiaowei-account-workspace-isolation-003
      text: Authenticated directory requests reject the host root, parent traversal, another account root, and a symlink escaping the account root; returned home and breadcrumb paths expose no host ancestor above that root.
      evidence:
        - packages/host/apiproxy/tests/api-proxy-workspace.spec.ts
    - id: ACC-xiaowei-account-workspace-isolation-004
      text: The assembled Xiaowei account preset omits shell, raw filesystem, subprocess, workflow, and delegated execution tools while the local standard preset retains them.
      evidence:
        - apps/cli/tests/web-agent-presets.e2e.ts
        - packages/host/apiproxy/tests/api-proxy-owner-isolation.spec.ts
    - id: ACC-xiaowei-account-workspace-isolation-005
      text: Workspace durable validation requires an explicit account owner or local owner marker and rejects media written with another workspace domain version.
      evidence:
        - packages/workspace/workspace/tests/workspace.spec.ts
        - packages/workspace/workspace/tests/invariant.spec.ts
        - packages/storage/storage-domain/tests/domain.spec.ts
  evidence:
    - packages/workspace/workspace/src/index.ts
    - packages/host/apiproxy/src/api-proxy.ts
    - packages/client/runtime/src/client/workspaces/service.ts
    - packages/bundle/xiaowei/cordis.patch.yml
  decisions:
    - .agents/notes/implemented/architecture/2026-08-26-account-workspace-and-execution-isolation.md
---
# 小薇账号工作区隔离

[English](account-workspace-isolation.md) | 中文

该功能阻止一个已登录的小薇账号选择或观察其他账号的服务端文件、工作区、Session 或宿主执行上下文。认证 principal 决定归属；浏览器提交的路径和工作区 ID 只是引用，不是授权。

## 运行时规则

账号工作区是按 owner 隔离的持久记录。账号创建 Session 时只能提交自有工作区 ID，或者由服务端派生私有账号根目录，不能提交浏览器选择的宿主 `cwd`。目录浏览会规范化每个请求路径，并让 home 和面包屑投影止于账号根目录。其他账号的工作区和 Session ID 与不存在的 ID 返回相同的 not-found 结果。

本机 principal 仍是部署管理身份，并保留现有宿主工作区行为。带有 local owner 标记的记录对账号不可见。网关强制认证小薇 Session 使用部署配置的账号 preset；账号请求不能选择或编写其他 preset。该 preset 会移除与宿主共享执行环境和不受限文件系统的工具，直到它们由账号隔离的执行提供方替代。

这是预发布格式切换，不执行数据迁移。首次启动升级后的小薇前，发布运维会备份并清除历史 Session 和 Workspace 介质。Workspace 领域版本 3 要求新的 owner 字段并拒绝旧介质，因此运行时绝不会为旧路径或对话猜测所属账号。

## 验证

验收组合工作区领域校验、认证 RPC 测试、目录逃逸测试、客户端请求字段检查和小薇 preset 组装检查。这些检查证明源码与已组装运行时行为。备份和清理历史介质、安装客户端与生产部署需要单独执行发布验收。
