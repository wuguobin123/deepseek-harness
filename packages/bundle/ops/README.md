# `@deepseek-ai/dsh-ops`

English | [中文](README.zh.md)

The dsh production **ops** profile. Long-running service over [`dsh-base`](../base/README.md) plus every `ops-*` product plugin. The webserver row binds `127.0.0.1:18000` (override via `DSH_OPS_PORT`) and `ops-webserver` registers an exact `/health` route plus a tiny `/` index. systemd `WatchdogSec` polls `/health` for liveness.

## Run

```sh
pnpm dsh --profile ops                # long-lived service
pnpm dsh --profile ops "smoke check"  # also run one task before idling
DSH_OPS_PORT=19000 pnpm dsh --profile ops
```

The patch rides directly over `dsh-base`. It inserts:
- `code-runtime` worker thread
- `ops-startup` (positional task + bind port provider)
- `webserver` on `127.0.0.1:<DSH_OPS_PORT or 18000>`
- `ops-webserver` (`/health` + `/` handlers)
- `ops-domain`, `ops-skill`, `ops-runtime`, `ops-subagent-python`
- `ops-platform`, `ops-approval-policy`, `ops-package-signing`, `ops-loop-guard`
- `ops-workbench-conversations`, `ops-workbench-memories`, `ops-workbench-trigger`, `ops-workbench-anomaly`
- `ops-runner` (drives an optional foreground task; absent `task` ⇒ idle forever)

## Plugin exports

- `@deepseek-ai/dsh-ops` — `ops-runner`
- `@deepseek-ai/dsh-ops/startup` — `ops-startup`
- `@deepseek-ai/dsh-ops/webserver` — `ops-webserver`
- `@deepseek-ai/dsh-ops/invariant` — empty invariant registration

## Model Experience

The optional foreground task is submitted as an ordinary user message; the persistent service adds nothing to the request prefix when no task is provided.

#### KV Cache effect

None; ops is a service composition, not a request-shape contribution.

## Known Limitations and Deferred Work

- **My-agents Python peer is opt-in.** `ops-subagent-python` mounts but only spawns the Python child when a delegating tool invokes the `ops-python` provider. The default Python entry point is `ops_runtime.subagent_main`; override with `DSH_OPS_PYTHON_MODULE`.
- **No `/api` gateway.** This profile exposes only the ops-plugin surface and `/health`. The web-gui API gateway lives in [`dsh-web-app`](../web-app/README.md); production deployments that need the gateway run both profiles behind a reverse proxy.
- **No browser surface.** The profile ships no UI; an HTTP `/` index exists only for operator sanity.