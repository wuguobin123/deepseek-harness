# Agent Note: Xiaowei account-routed Web search

Status: proposed

English | [中文](2026-08-27-xiaowei-account-web-search-routing.zh.md)

## Problem

The device Host composes the standard Web search tool but selects a credentialed DeepSeek Provider from its local credential store. A signed-in account can use the platform model through Electron without receiving the upstream model credential, yet the same local Session cannot search unless the user separately installs `DEEPSEEK_API_KEY` on the device. This splits one product account into unrelated credential paths and exposes provider setup to users who did not choose a custom Provider.

## Proposal

The device Host will select an account-remote Web search Provider. It will send one bounded query and result limit through a dedicated child-process protocol to Electron. Electron will call one authenticated `account.web.search` endpoint, and the production Host will invoke its configured `ctx.web.search` implementation under the bearer principal. Search results and structured failures will return to the local tool pipeline and remain in the local Session log.

The child protocol and account endpoint will be capability-specific. They will not accept arbitrary tool names, account identifiers, resource identifiers, paths, file references, Provider choices, bearer values, or credentials. Electron will retain the bearer, and the production Host will retain Provider credentials and derive identity only from the authenticated principal.

Cancellation and identity changes will terminate outstanding searches across every transport layer. The device Provider will correlate concurrent requests by opaque request ID and reject malformed or crossed frames. It will not fall back to a device credential when authentication, transport, or the production Provider fails.

Cloud Workspace search will continue to call the same production `ctx.web` service directly. Filesystem, Shell, Skill, approval, artifact, and Agent-loop ownership will remain unchanged in both Workspace locations.

## Alternatives considered

**Copy the production search credential to the device.** Rejected because it would expose a deployment credential outside server-side rotation, revocation, and secret-at-rest controls and would still require device credential synchronization.

**Reuse account inference as a generic tool relay.** Rejected because model streaming and Web capability execution have different request, cancellation, failure, and authorization rules. A generic relay would silently create a remote-execution channel for future tools.

**Send the local prompt to a cloud Session that performs research.** Rejected because it would move the Agent loop and durable conversation to the production Host, lose the local tool-result continuation, and blur cloud Session creation with account capability use.

**Keep the local DeepSeek Provider as a fallback.** Rejected for the signed-in default because behavior would depend on an unrelated device secret and could bypass the production Host's Provider policy. Custom local Providers remain an explicit separate configuration.

## Acceptance criteria

The approved [feature specification](../../../../docs/specs/xiaowei/account-web-search-routing.md) must have evidence for authenticated RPC behavior, device and Electron cancellation, an assembled keyless local runtime, production cloud regression, and installed-client local Workspace search before this note moves to implemented.

## Risks

Search result payloads are untrusted network data and must retain the Web capability's existing bounds and result representation. Electron adds one more long-lived child request family whose cleanup must reach completion during sign-out, account switching, Worker restart, and application shutdown. Production provider availability becomes a dependency of signed-in local research, but a failure stays local to that tool call and never changes Workspace ownership.
