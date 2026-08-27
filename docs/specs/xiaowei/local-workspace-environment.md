---
sdd:
  id: feature.xiaowei.local-workspace-environment
  kind: feature
  status: approved
  owners:
    - xiaowei-platform
  requirements:
    - id: REQ-xiaowei-local-workspace-environment-001
      text: Xiaowei Desktop renders local and cloud Workspaces in one complete product UI without replacing the renderer, hiding the established cloud feature set, or requiring a global execution-environment reload.
    - id: REQ-xiaowei-local-workspace-environment-002
      text: Every Workspace and Session has one immutable local or cloud execution location; desktop-visible identifiers preserve that location and route every related request, response, approval, artifact, subagent, and event only to its owning Host.
    - id: REQ-xiaowei-local-workspace-environment-003
      text: Adding a local Workspace selects one canonical directory through Electron and registers its path only with the desktop-supervised loopback Host, without scanning, serializing, uploading, or copying the directory.
    - id: REQ-xiaowei-local-workspace-environment-004
      text: Creating a cloud copy remains a separate confirmed operation that keeps bounded transfer, atomic publication, account ownership, and an independent-copy label; selecting, switching, or restoring a local Workspace never triggers that operation.
    - id: REQ-xiaowei-local-workspace-environment-005
      text: The local Worker exposes the established Shell, filesystem, search, plan, job, workflow, subagent, artifact, and Skill interactions through the same UI while resolving workspace-write confinement and approvals from each calling Session workspace.
    - id: REQ-xiaowei-local-workspace-environment-006
      text: Local files, Worker processes, Sessions, and approved Skill installations remain in the device runtime; the account bearer remains in Electron; platform-model credentials, wallet settlement, cloud Sessions, account data, model configuration, plugins, cloud copies, and account Skills remain isolated in the authenticated production Host.
    - id: REQ-xiaowei-local-workspace-environment-007
      text: The desktop keeps the cloud Host available while starting the loopback Host on demand, consumes both event streams independently, and degrades only the local Workspace group when the local Worker stops.
    - id: REQ-xiaowei-local-workspace-environment-008
      text: The packaged device runtime is built from a dedicated exact dependency manifest rather than the generic dsh CLI closure, includes native dependencies only for the artifact's declared operating system and CPU architecture, excludes Web renderer, cloud account, E2B, and telemetry dependencies, and keeps the macOS arm64 DMG increase over the accepted 0.3.16 product baseline within 35 MiB.
    - id: REQ-xiaowei-local-workspace-environment-009
      text: A 0.3.16 installation opens in the cloud product view; 0.3.17 and 0.3.18 connection preferences migrate only the last selected location and preserve existing local runtime data without uploading or deleting it.
    - id: REQ-xiaowei-local-workspace-environment-010
      text: Desktop cold start restores the stored account before mounting sidebar chrome, preserves the 0.3.16 user identity, wallet, Settings, and independent client-update actions, and retains the General, Models, Plugins, and Account settings sections while adding local Workspace preferences.
    - id: REQ-xiaowei-local-workspace-environment-011
      text: A signed-in local Session uses the account's platform model and wallet through an authenticated streaming inference request while its Agent loop, tool calls, tool results, files, processes, approvals, artifacts, and durable Session log remain exclusively in the device Host.
    - id: REQ-xiaowei-local-workspace-environment-012
      text: The local inference protocol derives account ownership only from the production Host bearer principal, never creates or looks up a cloud Session or Workspace, rejects owner, Workspace, path, file-reference, and local Session identifiers on the wire, and never returns the upstream model credential to Electron or the device runtime.
    - id: REQ-xiaowei-local-workspace-environment-013
      text: Every local platform-model attempt uses the same account-scoped provisioning, wallet reservation, usage settlement, cancellation, insufficient-balance, and audit behavior as a cloud Session, while sign-out, expiry, account switching, offline transport, and user cancellation terminate the affected inference stream without moving local execution to the cloud.
    - id: REQ-xiaowei-local-workspace-environment-014
      text: On an authenticated desktop with no current or recent Workspace, New Session creates and opens the account-default cloud task without asking the user to choose an execution location; an existing Session or Workspace continues to determine the immutable location of follow-up work.
    - id: REQ-xiaowei-local-workspace-environment-015
      text: The ordinary Workspace entry presents working with computer files as the primary action and places explicit local-versus-cloud-copy selection under advanced options; its copy distinguishes a directory copy from model-visible content that the selected model service receives.
    - id: REQ-xiaowei-local-workspace-environment-016
      text: The loopback device Host carries every generated Remote claimed by its active Typert registry, preserves the existing request and response envelopes, and returns unknown slash endpoints as not found instead of routing local Session operations to the production Host.
  acceptance:
    - id: ACC-xiaowei-local-workspace-environment-001
      text: Desktop unit checks exhaustively classify RPC methods, encode and decode location-bearing resource identifiers, reject cross-Host relationships, and prove that local paths and bytes never enter cloud requests.
      evidence: []
    - id: ACC-xiaowei-local-workspace-environment-002
      text: Desktop integration checks aggregate local and cloud Workspace and Session lists and event streams, preserve both groups across reconnects, and keep cloud operations available after a local Worker failure.
      evidence: []
    - id: ACC-xiaowei-local-workspace-environment-003
      text: Renderer checks show local and cloud Workspace groups in one sidebar, expose distinct local-open and cloud-copy actions, preserve the complete navigation and settings surfaces, and switch selections without reloading the document.
      evidence: []
    - id: ACC-xiaowei-local-workspace-environment-004
      text: An assembled local Worker reads and edits the original directory, observes external changes, runs a workspace-confined Shell command, completes a subagent or workflow operation, installs and immediately discovers a local Skill, and rejects traversal and symbolic-link escape.
      evidence: []
    - id: ACC-xiaowei-local-workspace-environment-005
      text: Existing two-account cloud isolation, wallet, model, plugin, artifact, Skill, and bounded cloud-copy checks remain green through the production Host.
      evidence: []
    - id: ACC-xiaowei-local-workspace-environment-006
      text: Runtime-closure checks build every release target independently, require its matching ripgrep, terminal, FFI, image, and sandbox native dependencies, reject build-host and wrong-target native packages together with the generic dsh CLI, Web renderer, cloud account, E2B, and telemetry packages, and publish a target-bearing per-package size ledger.
      evidence: []
    - id: ACC-xiaowei-local-workspace-environment-007
      text: Packaged macOS and Windows acceptance runs prove the dual Workspace groups, original-directory execution, explicit cloud copying, restart migration, local-failure isolation, and the package-size budget at the installed-client layer.
      evidence: []
    - id: ACC-xiaowei-local-workspace-environment-008
      text: A packaged-client migration from a signed-in 0.3.16 profile shows the restored identity, wallet, independent update action, and the complete General, Models, Plugins, and Account inventory; a signed-out client still exposes both Settings and update actions.
      evidence: []
    - id: ACC-xiaowei-local-workspace-environment-009
      text: Protocol and carrier checks reject forged ownership, local resource identifiers, file references, unknown fields, unauthenticated callers, malformed or out-of-order stream frames, and prove that a local inference request creates no cloud Workspace, Session, or durable prompt record.
      evidence: []
    - id: ACC-xiaowei-local-workspace-environment-010
      text: An assembled signed-in local Session receives a platform-model tool call, executes the requested filesystem or Shell operation against the original device directory, returns the local tool result to the next cloud inference attempt, reaches a final response, and records exactly one account wallet settlement per provider attempt without exposing the provider credential.
      evidence: []
    - id: ACC-xiaowei-local-workspace-environment-011
      text: Desktop and service checks distinguish sign-out, expired authentication, account switching, cloud unavailability, insufficient balance, provider failure, and user cancellation; each case stops the old stream, releases or settles its reservation according to observed usage, keeps the local Session recoverable, and leaves cloud Workspace execution unaffected.
      evidence: []
    - id: ACC-xiaowei-local-workspace-environment-012
      text: Sandbox and desktop checks prove that workspace-write foreground and background commands receive only runner-authorized cache paths, read-only and danger-full-access behavior remains unchanged, and a local question request, response, and resolved event use one location-bearing correlation id so the submitted card closes after authoritative resolution.
      evidence:
        - packages/sandbox/sandbox-local/tests/local.spec.ts
        - packages/sandbox/sandbox-local/tests/acl-grants.spec.ts
        - packages/sandbox/sandbox-windows-acl/tests/runner.spec.ts
        - packages/shell/bash-sandbox/tests/sandbox.spec.ts
        - packages/shell/pwsh-sandbox/tests/sandbox.spec.ts
        - apps/desktop/tests/dual-host-router.test.ts
    - id: ACC-xiaowei-local-workspace-environment-013
      text: Client runtime and renderer checks prove that New Session creates a Host-default task when no Workspace exists, existing work inherits its Workspace location, the primary directory action opens computer files locally, and explicit local or cloud-copy selection is available only through advanced options.
      evidence:
        - packages/client/runtime/tests/workspaces-service.client.spec.ts
        - packages/client/ui-workspace/tests/workspace-picker.client.spec.tsx
        - packages/client/ui-workspace/tests/workspace-browser.client.spec.tsx
        - apps/desktop/tests/dual-host-router.test.ts
        - apps/desktop/tests/ipc-handlers.test.ts
    - id: ACC-xiaowei-local-workspace-environment-014
      text: Gateway, device-carrier, and desktop routing checks prove that a generated Remote for a local Session reaches the device service, keeps its local Agent identity, returns the generated result, and leaves unknown slash endpoints unclaimed.
      evidence:
        - packages/api/gateway/tests/gateway.host.spec.ts
        - packages/host/api-core/tests/index.spec.ts
        - apps/desktop/tests/dual-host-router.test.ts
  evidence: []
  decisions:
    - .agents/notes/proposed/architecture/2026-08-27-workbuddy-federated-desktop.md
    - .agents/notes/implemented/bug-fix/2026-08-27-xiaowei-local-runtime-interaction-reliability.md
    - .agents/notes/implemented/bug-fix/2026-08-27-xiaowei-device-remote-carrier.md
---
# Xiaowei local and cloud workspaces

English | [中文](local-workspace-environment.zh.md)

## Outcome

Xiaowei Desktop follows the WorkBuddy execution model: one complete product UI presents device-owned and account-owned Workspaces together, while each Workspace and Session executes only in the Host that owns it. Opening a local directory keeps its files, Worker, Sessions, and Skills on the device. Creating a cloud copy is an explicit account operation for work that must continue on the server.

## Requirements

### REQ-xiaowei-local-workspace-environment-001 through REQ-xiaowei-local-workspace-environment-016

The frontmatter owns the observable requirements. A signed-in local task may send its assembled model-visible conversation and tool schema through the account inference stream, but Electron retains the bearer, the production Host derives the account from that bearer, and neither side converts inference traffic into a cloud Workspace or Session.

## Acceptance

### ACC-xiaowei-local-workspace-environment-001 through ACC-xiaowei-local-workspace-environment-014

Implementation must close routing, renderer, device Worker, cloud regressions, dependency closure, package size, and installed-client behavior separately. Source and unit checks cannot satisfy packaged desktop acceptance.

## Decisions

The [federated desktop proposal](../../../.agents/notes/proposed/architecture/2026-08-27-workbuddy-federated-desktop.md) owns the Host federation, resource identity, local Worker, migration, and packaging decisions. The [local runtime reliability decision](../../../.agents/notes/implemented/bug-fix/2026-08-27-xiaowei-local-runtime-interaction-reliability.md) owns sandbox cache placement and interactive-question correlation. The [device Remote carrier decision](../../../.agents/notes/implemented/bug-fix/2026-08-27-xiaowei-device-remote-carrier.md) owns generated Remote transport over the loopback Host.
