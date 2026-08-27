# Agent Note: Xiaowei production health is a bundled route

Status: implemented

English | [中文](2026-08-24-xiaowei-production-health-and-artifact-build.zh.md)

## Problem

The Xiaowei bundle described `/health` as its production liveness endpoint but did not register the exact route. Its first implementation also added a public `./webserver` export without an artifact entry, so a source launch could discover the row while the production profile could not import `lib/webserver.js`. The deployment workflow additionally copied desktop installers and triggered Electron downloads even though neither contributes to the backend runtime.

## Decision

Xiaowei owns an exact `/health` route through `src/webserver.ts`. The bundle patch mounts `xiaowei-webserver` after the HTTP server, and `./webserver` is a public package export emitted by the package-local tsdown configuration.

The Xiaowei deploy gate explicitly emits that package's TypeScript and tsdown artifacts before syncing them. It excludes `apps/desktop`, skips Electron binary download for the remote dependency install, stops the legacy `dsh-ops` listener before restarting Xiaowei, and routes the desktop's bare-IP authority without replacing the legacy default nginx server. The route responds with `status`, `service: "dsh-xiaowei"`, and process uptime.

## Verification

The repository typecheck builds the new `lib/types/webserver.js` and `lib/webserver.js`; the Xiaowei profile dump contains the `xiaowei-webserver` entry. Production validation confirms the loopback and public `/health` responses identify `dsh-xiaowei`, nginx syntax succeeds, the legacy service is inactive, and the SPA and static release URLs remain reachable.

## Alternatives considered

**Use the frontend fallback as liveness.** Rejected because a successful static HTML response does not prove the API carrier or its exact routing is live.

**Reference the TypeScript source from the bundle patch.** Rejected because deployment resolves package exports from `lib/`; a public loader entry must have a built artifact.

**Keep the legacy service on the same listener.** Rejected because two processes cannot own `127.0.0.1:18000`; explicitly stopping the predecessor makes the cutover observable.

## Consequences

Production deployment has a short, deliberate service-restart window while the old listener is replaced. Backend rollouts no longer transfer desktop source or installers, and they avoid downloading an Electron runtime on the server. Future public Xiaowei subpaths require a matching package export and artifact entry.
