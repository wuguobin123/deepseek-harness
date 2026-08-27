# @deepseek-ai/dsh-xiaowei-local

English | [中文](README.zh.md)

The Xiaowei device runtime composes its exact host manifest with this bundle. It binds the desktop-supervised Host to an operating-system-assigned loopback port and exposes only the `xiaowei-local-safe` preset. The preset contains workspace-confined filesystem and search tools, workspace-scoped Shell execution, background jobs, web search, workflows, in-process subagents, Skill loading, and approval-protected local Skill installation.

The selected directory remains the live workspace; opening it never turns it into a cloud-copy import and does not impose an upload-size limit. Model settings, credentials, Sessions, Workspace metadata, Worker processes, and installed Skills remain under the local Harness home. The cloud environment remains a separate Host, and creating a cloud copy is an explicit desktop action. Content intentionally included in a model request still reaches that configured model provider.

## Model Experience

### Device-local capabilities

#### What the model sees

The model sees only the `xiaowei-local-safe` preset and its local Worker tool schemas. Filesystem tools and Shell default to the selected workspace and enforce its sandbox policy. Workflow and subagent providers run on the device. A `skill_install` call names the proposed Skill and pauses for user approval before atomically publishing it below the device-local Harness home; installed instructions enter a later model request only when Skill lookup and invocation select them.

#### Token effect

The local Worker tool schemas contribute a stable request prefix. Installed Skill content is data-dependent and contributes tokens only to a later request that selects that Skill.

#### KV Cache effect

The local preset tool-schema prefix is stable for an Agent instance. Installing a Skill does not rewrite the active request; selecting it later may add its stored instructions and change that later request's context.

## Known Limitations and Deferred Work

- Local mode does not consume the account wallet; the user must configure a model provider in the local runtime.
- Local Sessions stop when the desktop Host is unavailable; use the separate cloud environment for server-continuous work.
- The device package includes only the local runtime closure. Account, wallet, cloud Skill store, cloud Workspace storage, Web renderer, E2B, and telemetry packages remain outside it.
