# Agent Note: Workspace selection retains newly created session membership

Status: implemented

English | [中文](2026-08-25-workspace-session-local-attachment.zh.md)

## Problem

Selecting a Workspace with no locally reusable blank Session created a Session on the Host, but the client kept neither the Workspace membership nor its canonical directory until a later Workspace frame arrived. The selected Session therefore appeared ungrouped, the hero returned to “choose Workspace”, and repeated picks created further blank Sessions.

## Decision

`WorkspaceRuntime.connectWorkspace()` passes the chosen Workspace path to the sessions projection while sending only `workspaceId` to `session.create`. On success, `WorkspaceManager.attachSession()` adds the Host-confirmed Session id to that Workspace’s local `sessionIds` before the next Host frame.

The sessions projection uses the local path only for the response-backed Session summary. It does not widen the `session.create` wire payload, which continues to send exactly one Workspace id.

## Verification

`workspaces-service.client.spec.ts` proves a newly created Workspace session has the canonical directory, appears in the owning Workspace immediately, and is reused by a second connect. `sessions-service.client.spec.ts` proves the local directory projection does not add `cwd` to the Workspace-scoped RPC payload.

## Alternatives considered

**Wait for a Host changed frame.** Frame delivery is asynchronous and the desktop transport may delay it behind the user action, leaving the picker visually unselected and allowing repeated clicks to create more Sessions.

**Infer membership from any matching directory.** A Session created outside a Workspace can share its directory. Reuse remains restricted to ids explicitly present in the owning Workspace’s local membership list.

## Consequences

- The selected Workspace is visible as soon as its Session creation succeeds, without a second list refresh.
- A local attachment is replaced by the next authoritative Workspace baseline or changed frame.
- A Workspace removed while creation is completing is not recreated locally; its successful Session remains available for the Host baseline to classify.
