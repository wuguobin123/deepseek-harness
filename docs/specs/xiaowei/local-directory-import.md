---
sdd:
  id: feature.xiaowei.local-directory-import
  kind: feature
  status: implemented
  owners:
    - xiaowei-platform
  requirements:
    - id: REQ-xiaowei-local-directory-import-001
      text: The desktop client selects and reads an existing local directory, sends only relative paths and file bytes, and never sends the local absolute path.
    - id: REQ-xiaowei-local-directory-import-002
      text: The desktop rejects links and special files before upload; the authenticated workspace.importDirectory method independently validates relative paths, canonical base64, duplicate paths, file count, per-file bytes, total bytes, and importId before publishing a workspace.
    - id: REQ-xiaowei-local-directory-import-003
      text: The server stages files below the bearer-derived account workspace root, atomically publishes the directory, and creates an account-owned imported-copy Workspace only after the copy succeeds.
    - id: REQ-xiaowei-local-directory-import-004
      text: Imported copies are explicitly presented as copies and do not claim synchronization with the source directory.
    - id: REQ-xiaowei-local-directory-import-005
      text: The Xiaowei account preset exposes text file and search tools only with canonical path confinement to the calling session workspace; shell and other same-host execution remain absent.
  acceptance:
    - id: ACC-xiaowei-local-directory-import-001
      text: Focused API tests cover two-account isolation, importId idempotency, traversal and content rejection, all size limits, and no workspace publication after a failed copy.
      evidence:
        - packages/host/apiproxy/tests/api-proxy-workspace.spec.ts
    - id: ACC-xiaowei-local-directory-import-002
      text: Desktop tests prove native selection, bounded relative-file serialization, link rejection, and remote-baseUrl routing to the import surface.
      evidence:
        - apps/desktop/tests/directory-import.test.ts
        - apps/desktop/tests/ipc-handlers.test.ts
        - apps/desktop/tests/directory-flow.test.ts
    - id: ACC-xiaowei-local-directory-import-003
      text: Filesystem and search tests prove that absolute paths, parent traversal, and symlink escapes cannot leave an account session workspace.
      evidence:
        - packages/fs/tool-fs/tests/tools.spec.ts
        - packages/fs/tool-fs-search/tests/workspace-path.spec.ts
  evidence:
    - packages/host/apiproxy/src/api/workspace.ts
    - packages/host/apiproxy/src/api-proxy.ts
    - apps/desktop/src/main/directory-import.ts
    - apps/desktop/src/shared/contracts.ts
  decisions:
    - .agents/notes/implemented/feature/2026-08-26-xiaowei-local-directory-import.md
---
# Xiaowei local directory import

English | [中文](local-directory-import.zh.md)

## Status

The first implementation uses one bounded JSON request containing base64 file bytes; it does not provide resumable chunk upload.

## Runtime rules

The Electron main process opens a native directory chooser and traverses the selected directory. It rejects symbolic links, junctions, special files, parent traversal, and configured file-count, per-file, and total-byte limits. The request contains `importId`, a display title, and relative file paths with base64 content; the local absolute path stays in the main process.

The authenticated gateway derives ownership only from the bearer principal. It stages under that account's private workspace root, validates every path, publishes atomically, and registers the Workspace after a complete copy. Repeating `importId` returns the original Workspace for that account. Failed imports do not publish a Workspace.

The returned Workspace title is marked `（导入副本）`. The copy is independent: later changes to the original local directory are not synchronized. Xiaowei's account preset receives `read`, `write`, `edit`, `glob`, and `grep`; both tool suites canonicalize model-selected roots and reject paths outside the session workspace. The preset does not gain shell, job, workflow, or delegated execution.

## Limitations

The single request is limited to 200 files, 5 MiB per file, and 25 MiB total and is unsuitable for large directories. Empty child directories are not represented. A future chunked protocol must preserve staging, idempotency, and atomic publication.
