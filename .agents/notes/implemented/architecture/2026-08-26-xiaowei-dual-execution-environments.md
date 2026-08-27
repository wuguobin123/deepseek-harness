# Agent Note: Xiaowei dual execution environments

Status: implemented

English | [中文](2026-08-26-xiaowei-dual-execution-environments.zh.md)

## Problem

A production Host cannot open a directory that exists only on the Electron computer. Copying every selected directory to the production Host makes ordinary local work depend on transfer limits, duplicates storage, loses live synchronization with external edits, and places files in a different execution environment than the user selected.

## Decision

Xiaowei Desktop owns two explicit execution environments behind one renderer. Local is the fresh-install default and connects to one desktop-supervised `xiaowei-local` Host bound to an OS-assigned loopback port. Cloud connects to the configured production Host. Sessions and Workspaces belong to the Host that created them; the renderer does not merge their identifiers.

Electron selects and canonicalizes a local directory, then sends the path only to the loopback Host's `workspace.create` method. Cloud selection retains `workspace.importDirectory`, including bounded serialization, account ownership, atomic publication, and the imported-copy label. The environment setting replaces inference from `baseUrl`.

The local Host uses its own Harness home below Electron application data. It mounts workspace-confined filesystem and search tools, local Skill discovery, and an approval-protected local `skill_install` consumer. It does not mount same-host shell tools until the sandbox implementation derives its writable and readable roots from each Session workspace instead of the supervisor process directory.

Local model calls use model settings and credentials stored by the local Host. Model messages and selected tool results necessarily reach the configured model provider, but the desktop never uploads the directory tree as a cloud Workspace. Account, wallet, update, and cloud-copy operations continue to use the production Host.

The supervisor accepts readiness only from the child process it spawned and only for a `127.0.0.1` URL. Renderer code receives neither child-process access nor credentials. Environment switching aborts current downlinks before changing the RPC target; application shutdown first requests graceful child termination and uses bounded forced termination only if the child does not exit.

The environment and cloud base URL are non-secret connection preferences stored atomically in a mode-`0600` JSON file. Account session tokens remain in Electron `safeStorage`. Environment switching therefore does not synchronously access the operating-system key store or re-encrypt an unchanged account token.

## Alternatives considered

**Increase directory-upload limits.** Rejected because larger limits retain duplicate storage, stale copies, startup latency, and a false implication that opening a local directory requires cloud publication.

**Run the Agent in the production Host and call filesystem tools back on the desktop.** Rejected because it creates a bidirectional remote-tool protocol, makes desktop availability part of every cloud turn, and gives a remote process an ongoing capability to invoke local effects.

**Expose an account model credential to the desktop automatically.** Rejected because it bypasses the production wallet settlement path and turns a server-held credential into a device secret without an explicit credential-export contract.

**Enable the standard local coding preset unchanged.** Rejected because its process-wide sandbox root does not prove confinement to each selected Session workspace in a multi-workspace desktop Host.

## Testing

The implemented [feature specification](../../../../docs/specs/xiaowei/local-workspace-environment.md) owns the acceptance IDs. The evidence covers focused routing and supervisor tests, an assembled local runtime test, existing cloud isolation regressions, a built desktop dependency audit, and a packaged Electron run against an ordinary directory.

- `CI=true pnpm --filter @deepseek-harness/desktop test` passed 89 tests, including local and cloud routing, native directory selection, environment persistence, and signed-out cloud recovery.
- `CI=true pnpm --filter @deepseek-harness/desktop typecheck` and `pnpm --filter @deepseek-harness/desktop build` passed.
- `CI=true pnpm run test:snapshot -- apps/cli/tests/xiaowei-local.snapshot.ts` passed the keyless assembled profile snapshots. The Xiaowei case reads and edits the selected source directory, rejects traversal and symbolic-link escape, omits shell tools, and installs and discovers a local Skill without restart.
- Focused account Skill, account Skill-store, Workspace isolation, local Skill, and profile-resolution checks passed 54 tests. `node scripts/verify-runtime-closure.ts --manifest apps/cli/package.json` closed 4 presets and 219 Workspace packages.
- `pnpm --filter @deepseek-harness/desktop package:mac` produced the Electron 35.7.5 Apple Silicon application and DMG with the self-contained Local Host. The packaged application opened a directory containing a 6 MiB file by registering `/private/tmp/xiaowei-packaged-workspace`; no file larger than 5 MiB appeared below its application data. It switched Local → Cloud → Local without blocking, exposed signed-out cloud recovery, and restored both the Local environment and Workspace registration after a clean restart.

## Consequences

The local runtime adds package size and process lifecycle work. A local Session cannot use the account's platform model credit unless a future authenticated model relay preserves wallet accounting; the UI must explain local model configuration instead of silently falling back to cloud execution. Files intentionally included in prompts still leave the machine for the selected model provider. Shell omission narrows the first local release but preserves the claimed workspace confinement.
