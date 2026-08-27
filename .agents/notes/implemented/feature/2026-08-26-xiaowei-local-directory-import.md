# Agent Note: Xiaowei local directory import

Status: implemented

English | [中文](2026-08-26-xiaowei-local-directory-import.zh.md)

## Problem

The remote Xiaowei desktop previously routed Add Workspace to server-directory browsing. That surface cannot select files on the computer running Electron, and exposing ordinary filesystem consumers to account sessions would let model-controlled absolute paths read outside the account workspace.

## Decision

For a remote base URL, Electron selects and serializes a bounded, link-free local directory and calls `workspace.importDirectory` without disclosing the local absolute path. The method derives ownership from the bearer principal, stages below the account root, atomically publishes, and creates a `（导入副本）` Workspace. The Xiaowei account preset mounts filesystem and search consumers with mandatory canonical containment under the session workspace. The current import is one JSON request with 200-file, 5 MiB per-file, and 25 MiB total limits.

## Alternatives considered

**Keep remote browsing.** Rejected because it only sees the service host and cannot select a directory on the Electron computer.

**Mount the standard filesystem consumers unchanged.** Rejected because absolute paths and symlinked search roots could expose files outside an account workspace.

**Start with resumable chunk upload.** Deferred until directories above the bounded first-release limits are a supported product requirement.

## Consequences

Users can select an ordinary local directory and immediately explore or edit its private server copy. Source changes after import are not synchronized, empty child directories are omitted, and large directories require a future transfer protocol. Account sessions gain text-file exploration without shell access or host-wide file visibility. Focused desktop, API, filesystem, and search tests cover the selection, transfer, rollback, ownership, and containment paths.

## Related

- [Desktop adaptive directory flow](../bug-fix/2026-08-23-desktop-adaptive-directory-flow.md), partially superseded for remote Electron connections.
