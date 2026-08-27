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
# Xiaowei account workspace isolation

English | [中文](account-workspace-isolation.zh.md)

This feature prevents one signed-in Xiaowei account from selecting or observing another account's server-side files, workspaces, Sessions, or host execution context. The authenticated principal selects ownership; browser paths and workspace ids are references, not authorization.

## Runtime rules

Account workspaces are durable owner-scoped records. Account Session creation accepts an owned workspace id or derives a private account root on the server. It never accepts a browser-selected host cwd. Directory browsing canonicalizes every requested path and stops home and breadcrumb projection at the account root. Foreign workspace and Session ids return the same not-found result as absent ids.

The local principal remains the deployment management identity and retains existing host workspace behavior. Records with the local owner marker stay unavailable to accounts. The gateway forces authenticated Xiaowei Sessions onto the deployment-configured account preset; account requests cannot select or author another preset. That preset excludes same-host execution and unrestricted filesystem tools until an account-confined execution provider replaces them.

This is a pre-release format cut, not a migration. Before the first upgraded Xiaowei start, release operations back up and clear historical Session and Workspace media. Workspace domain version 3 requires the new owner field and refuses old media, so the runtime never guesses an account for an old path or conversation.

## Verification

Acceptance combines workspace-domain validation, authenticated RPC tests, directory-escape tests, client payload checks, and an assembled Xiaowei preset check. These checks prove source and assembled-runtime behavior. Backup and historical-media clearing, an installed client, and a production deployment require separate release acceptance.
