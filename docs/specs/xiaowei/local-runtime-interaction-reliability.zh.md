---
sdd:
  id: feature.xiaowei.local-runtime-interaction-reliability
  kind: feature
  status: implemented
  owners:
    - xiaowei-platform
  requirements:
    - id: REQ-xiaowei-local-runtime-interaction-reliability-001
      text: Workspace-write Shell commands route framework and package-manager caches to a temporary area already authorized by the selected platform sandbox without granting write access to the user home cache; read-only and danger-full-access behavior remains unchanged.
    - id: REQ-xiaowei-local-runtime-interaction-reliability-002
      text: A local interactive-question request and its resolved event preserve the same owning Host location so the desktop settles the pending card only after the authoritative resolution arrives.
  acceptance:
    - id: ACC-xiaowei-local-runtime-interaction-reliability-001
      text: Sandbox and Shell unit checks prove cache environment selection, matching temporary-directory grants, foreground and background environment precedence, and Windows private-temp propagation.
      evidence:
        - packages/sandbox/sandbox-local/tests/local.spec.ts
        - packages/sandbox/sandbox-local/tests/acl-grants.spec.ts
        - packages/sandbox/sandbox-windows-acl/tests/runner.spec.ts
        - packages/shell/bash-sandbox/tests/sandbox.spec.ts
        - packages/shell/pwsh-sandbox/tests/sandbox.spec.ts
    - id: ACC-xiaowei-local-runtime-interaction-reliability-002
      text: Desktop routing checks prove that a local requested-question RPC id accepts the answer on the local Host and matches the later resolved event without routing either operation to the cloud Host.
      evidence:
        - apps/desktop/tests/dual-host-router.test.ts
  evidence:
    - packages/sandbox/sandbox-local/src/index.ts
    - packages/sandbox/sandbox-local/src/profiles.ts
    - packages/sandbox/sandbox-windows-acl/src/runner.ts
    - packages/shell/bash-sandbox/src/index.ts
    - packages/shell/pwsh-sandbox/src/index.ts
    - apps/desktop/src/main/dual-host-router.ts
  decisions:
    - .agents/notes/implemented/bug-fix/2026-08-27-xiaowei-local-runtime-interaction-reliability.md
---
# 小薇本机运行时交互可靠性

[English](local-runtime-interaction-reliability.md) | 中文

此功能在不扩大文件系统权限的前提下保证本机可写命令可用，并让本机交互式问题始终与其来源 Host 对齐。

## 运行时行为

`workspace-write` confinement 从对应 runner 已授权的临时区域选择缓存目录。Bash 与 PowerShell 在调用方环境值之后应用 runner 拥有的 `XDG_CACHE_HOME` 和 `NPM_CONFIG_CACHE`，前台与后台执行保持一致。Linux、macOS 和 Windows 继续沿用各自 runner 的临时目录隔离方式。

桌面双 Host 路由器把 `questionRpcId` 归类为 Host 拥有的关联标识。本机问题的请求、回答和 resolved 事件会保留相同的位置标签，直到客户端关闭待处理卡片。

## 验证范围

映射的单元检查证明源码层的 runner 选择、授权对齐、环境传播和本机问题路由。安装包客户端与生产发布仍是独立的发布门禁。
