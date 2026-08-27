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
# Xiaowei local runtime interaction reliability

English | [中文](local-runtime-interaction-reliability.zh.md)

This feature keeps writable local commands usable without widening their filesystem authority and keeps local interactive questions aligned with their originating Host.

## Runtime behavior

Workspace-write confinement selects a cache directory from the temporary area already granted by its runner. Bash and PowerShell apply the runner-owned `XDG_CACHE_HOME` and `NPM_CONFIG_CACHE` values after caller environment values for both foreground and background execution. Linux, macOS, and Windows retain their existing runner-specific temporary-directory isolation.

The desktop dual-Host router classifies `questionRpcId` as a Host-owned correlation identifier. A local question request, answer, and resolved event therefore keep the same location tag until the client removes the pending card.

## Verification scope

The mapped unit checks prove source-level runner selection, grant alignment, environment propagation, and local question routing. Packaged-client and production publication remain separate release gates.
