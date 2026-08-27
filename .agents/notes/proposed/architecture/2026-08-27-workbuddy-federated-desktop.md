# Agent Note: WorkBuddy-style federated Xiaowei desktop

Status: proposed

English | [中文](2026-08-27-workbuddy-federated-desktop.zh.md)

## Problem

A global local-or-cloud connection replaces the complete cloud product with one restricted Host, reloads the renderer, and makes established capabilities appear removed. Packaging the generic dsh CLI production closure with that Host more than doubles the installed application and adds dependencies unrelated to device Workspace execution.

## Proposal

Xiaowei Desktop will keep one complete renderer and federate one production Host with one on-demand loopback device Host. The sidebar will group local and cloud Workspaces, and location-bearing desktop identifiers will keep every Workspace, Session, event, approval, artifact, subagent, and workflow operation on its owning Host. Local failure will not interrupt the cloud group.

New Session will start work without presenting execution location as a prerequisite. With no current or recent Workspace, the authenticated desktop creates the account-default cloud task; work started from an existing Session or Workspace inherits that resource's location. The ordinary directory action opens computer files through the device Host, while an advanced submenu retains explicit local registration and cloud-copy import. Location labels remain explanatory metadata, not a global mode.

Electron will pass a selected directory's canonical path only to the loopback Host. A separate confirmed cloud-copy action will keep the bounded, account-owned import protocol. Selection, restoration, and ordinary local execution will never upload the directory.

The device Host will provide the normal local Worker capabilities through the same UI. Filesystem tools will keep canonical Workspace containment; Shell and child execution will use the existing per-Session sandbox policy and approval flow, with delegated work inheriting the Session location, cwd, and permission state. Local Skill installation will publish only below the device runtime home, while cloud installation will remain account-scoped on the production Host.

A signed-in local Session will use the account platform model without moving its Agent loop to the production Host. The device Host will assemble each model request and receive streamed text, reasoning, tool calls, usage, and finish frames; it will execute tool calls locally and send the resulting logged conversation in the next model attempt. Electron will relay this stream over its existing authenticated cloud connection so the account bearer never enters the device child process, while the production Host will derive ownership only from the bearer, reserve and settle the same wallet, and retain the upstream model credential. The inference route will reject local Session, Workspace, owner, path, and file-reference fields and will not create cloud Sessions or Workspaces.

A dedicated private device-runtime application will own an exact production dependency manifest and fixed Cordis composition. Desktop packaging will deploy that application instead of `@deepseek-ai/dsh`, exclude browser-renderer and cloud-only packages, and unpack only native modules that require real files. Each platform script will declare the artifact operating system and CPU architecture to the runtime builder; that builder will require the matching native packages, reject build-host and wrong-target variants, and record the target in a per-package size ledger. Package verification will also reject a macOS arm64 DMG whose increase over the accepted 0.3.16 baseline exceeds 35 MiB.

Connection preferences will stop representing global execution ownership. A 0.3.16 installation will start from the cloud product view; 0.3.17 and 0.3.18 preferences will migrate only the last selected resource location. Existing device runtime data will remain in place and will not be uploaded or deleted.

## Alternatives considered

**Keep a global execution-environment switch.** Rejected because one Host replaces the other Host's Workspace and Session inventory, reloads the complete renderer, and turns capability differences into an apparent product downgrade.

**Present local and cloud as equal first-run choices.** Rejected because an execution topology question blocks users who only need to begin a task or use files on their computer. Explicit location remains available after the primary task action.

**Increase the restricted local profile's tool roster without Host federation.** Rejected because it improves local tasks but still hides the user's cloud Workspaces and account product whenever local is selected.

**Continue packaging the generic dsh CLI.** Rejected because its manifest intentionally anchors every shipped profile and provider, so dependency filtering cannot produce a device-specific runtime.

**Infer the packaged runtime target from the build host.** Rejected because one macOS arm64 release job also produces macOS x64, Linux x64, and Windows x64 artifacts. Host inference can silently put unusable native binaries in every cross-built artifact.

**Upload every selected directory.** Rejected because copies impose transfer limits, duplicate storage, lose synchronization with external edits, and change the execution location without a distinct user operation.

**Send the entire local prompt to cloud `session.prompt`.** Rejected because the cloud Agent loop would own tool execution and could neither safely access the original directory nor prove that Shell, Skill, approval, and artifact effects stayed on the device.

**Copy the provisioned platform-model key into the device runtime.** Rejected because a long-lived upstream credential would escape service-side revocation, account isolation, wallet enforcement, and secret-at-rest controls. Electron relays an authenticated inference stream instead.

**Require a separate user-supplied model key for every local Workspace.** Retained as an optional custom-provider path, but rejected as the signed-in default because it makes the registration model and welcome balance unusable for the product's primary local execution flow.

## Acceptance criteria

The approved [feature specification](../../../../docs/specs/xiaowei/local-workspace-environment.md) must have repository evidence for every acceptance ID, including installed-client and package-size evidence, before this note moves to implemented.

## Risks

Federating two mutable Host streams requires location-safe identifiers and exhaustive method routing; a missing classification must fail closed instead of guessing. The inference relay intentionally sends model-visible conversation and tool schemas to the production Host, so the UI and documentation must distinguish that from uploading a Workspace copy. Restoring the full local Worker increases the trusted device process and native dependency set. The package budget may require a smaller fixed composition than the generic base bundle rather than manifest filtering alone.
