# Agent Note: Xiaowei local runtime cache and interaction correlation

Status: implemented

English | [中文](2026-08-27-xiaowei-local-runtime-interaction-reliability.zh.md)

## Problem

Workspace-write confinement authorizes the selected Workspace and a platform temporary area, but command-line tools can derive caches from `HOME`. On macOS, Next.js therefore attempted to create `~/Library/Caches/next-swc` and received `EPERM` even though the project itself was writable. Separately, the desktop tagged an interactive question request's outer RPC id with its Host location but left `question/resolved.questionRpcId` untagged. The client could submit an answer to the correct local Host, yet could not match the resolution to its pending question card.

## Decision

`LocalSandboxProvider.confine()` returns cache environment overrides only for `workspace-write`. The overrides set `XDG_CACHE_HOME` and `NPM_CONFIG_CACHE` to the temporary area already authorized by the selected runner. Bubblewrap uses its isolated `/tmp`; Landlock and Seatbelt use their granted platform temporary directory. The Windows ACL runner sets the same variables alongside `TMP` and `TEMP` after choosing its per-Session private temporary directory. Bash and PowerShell sandbox executors merge these runner-owned overrides after caller environment values for foreground and background processes. Read-only confinement receives no writable cache environment, and danger-full-access execution does not pass through confinement.

The desktop dual-Host router treats the exact `questionRpcId` field as a Host-owned correlation id. Both `question/requested.rpcId` and `question/resolved.questionRpcId` therefore receive the same location tag before reaching the client. Responses strip that tag and return to the Host that created the question. The client continues to remove the card only after the authoritative resolved event arrives.

## Alternatives considered

**Grant the user cache directory to workspace-write commands.** Rejected because it expands a Workspace-scoped write capability into unrelated user state and lets commands modify caches shared with processes outside the Session.

**Set cache variables in the Electron local-runtime supervisor.** Rejected because the supervisor does not know the runner-selected Windows private temporary directory, would also affect read-only and danger-full-access commands, and would separate environment selection from the write capability that makes the directory usable.

**Close the question card when the response call returns.** Rejected because a successful transport response does not prove that the Host accepted and durably resolved the question. The resolved event remains the authoritative lifecycle signal.

## Consequences

Workspace-write commands can populate common framework and package-manager caches without receiving write access to the user's home cache. POSIX runners retain their existing temporary-area sharing; Windows keeps its stronger per-Session temporary isolation. Tools that ignore `XDG_CACHE_HOME`, `NPM_CONFIG_CACHE`, `TMP`, and `TEMP` may still need a separately justified environment mapping, but that does not widen confinement.

Local interactive questions now settle through the same pending-card lifecycle as cloud questions. Any future Host-owned correlation field still requires an explicit router classification and regression because arbitrary `*Id` fields are not assumed to be execution-location resources.
