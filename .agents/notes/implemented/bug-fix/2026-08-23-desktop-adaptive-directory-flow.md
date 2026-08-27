# Agent Note: Desktop resolves its directory-flow surface from the baseUrl

Status: implemented

English | [中文](2026-08-23-desktop-adaptive-directory-flow.zh.md)

## Problem

The desktop (Electron) renderer statically bundles one directory-flow surface and activated the **native** one unconditionally, which drives `host.pickDirectory` — a privileged RPC pinned to loopback callers that opens the OS chooser on the *host's* display. Point the desktop at a remote host and Add Workspace failed with `directory picker failed: forbidden` (the connection fence's 403 body surfaced as the RPC error message). Even past the fence the attempt is doomed: a remote host under systemd has no display session, so `directory-picker-auto` composes the browse backend and no native capability exists to call. The web UI has no such failure mode because the host mounts the matching client surface as a Loader entry ([adaptive default](../feature/2026-07-29-directory-picker-adaptive-default.md)); the desktop boot had no equivalent resolution — one hard-wired surface for every deployment shape.

## Decision

`bootRenderer` takes the configured `baseUrl` (sampled from the main-process session through the preload bridge at each boot) and resolves the surface once per boot through a pure `resolveDirectoryFlowSurface(baseUrl)` in `apps/desktop/src/renderer/directory-flow.ts`: a loopback hostname (`localhost`, `[::1]`, any 127/8) resolves `native`, anything else resolves `browse`, and an unparseable baseUrl fails to `browse` — the surface that works for any reachable remote host. The rule mirrors the host-side resolver's first clause (loopback bind ⇒ attended operator): a loopback baseUrl means the host process runs on the operator's own machine, so the OS chooser opens on the display the operator watches. Remote baseUrls get the browse surface, whose `host.listDirectory`/`host.createDirectory` RPCs are open to trusted-host callers, unlike the loopback-pinned `host.pickDirectory`. The same change repaired the desktop `SlotMap` drift (`slots.d.ts` declared `sidebar.workspaces.directoryFlow` as `list` and omitted the hero hole) to match ui-workspace's authoritative `single`-with-owner declarations.

## Alternatives considered

- **Reuse the host's entry-mounting mechanism** — impossible: the desktop renderer has no Loader and no `/plugins` module feed; its plugin graph is a static Vite bundle, so the choice has to happen in renderer boot glue. The host-side note's deferred per-connection adaptivity is the same shape from the other side.
- **Try native, fall back to browse on failure** — rejected for the reasons the host-side note already recorded: both flows in one bundle plus a doomed RPC on every open, and a loopback-pinned 403 is not a transient error worth retrying.
- **An Electron-native dialog over a new preload IPC** — better UX for the loopback case (no osascript round-trip through the host), but the existing native surface already works there; add only if the host round-trip proves flaky. (Two unreferenced `features/directory-picker/` components from the porting phase anticipate this and stay unwired.)
- **Import `isLoopbackHostname` from `dsh-client-connection`** — the predicate's own docstring pins it package-internal; a nine-line local copy beats widening another package's API for one caller.

## Consequences

- Desktop pointed at a remote host gets the in-app browse dialog instead of the 403 error dialog; a loopback host keeps the OS chooser, unchanged.
- The choice is boot-time, matching the host's one-resolution-per-boot stability contract: editing the baseUrl in Settings applies to the picker on the next renderer boot, not live.
- The `ssh -L` blind spot is inherited: a desktop whose loopback baseUrl is a tunnel to a headless host resolves `native`, and the call fails with the backend's retryable error dialog (the host composed browse) — the same documented limit as the host-side resolver.
- `slots.d.ts` now mirrors the authoritative contract, so desktop typecheck catches future drift instead of hiding it.

## Testing

- `apps/desktop/tests/directory-flow.test.ts` pins the loopback / remote / unparseable resolution.
- Desktop typecheck and `build:renderer` cover the surface-import wiring; the loopback path is the previously shipped behavior.

## Related

- [Directory-picker capability seam](../architecture/2026-07-28-directory-picker-capability-seam.md)
- [Adaptive default for the directory-picker interaction](../feature/2026-07-29-directory-picker-adaptive-default.md)
- [Xiaowei local directory import](../feature/2026-08-26-xiaowei-local-directory-import.md), which supersedes the remote Electron `browse` decision with a bounded local-copy import; loopback and non-Electron surfaces retain this note's rules.
