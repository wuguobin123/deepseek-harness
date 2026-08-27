# @deepseek-ai/dsh-host-api-core

English | [中文](README.zh.md)

Device-safe loopback carrier for the Xiaowei local Worker. The default Cordis plugin requires `ctx.apiProxy` and `ctx.typertGateway`, binds an HTTP and WebSocket server to `127.0.0.1`, prints its selected URL when `printUrl` is enabled, and closes the listener and active event streams with its fiber. Config accepts `{port?, printUrl?}`; port `0` asks the operating system for an available port.

Legacy dot-form ApiProxy calls and every slash-form endpoint claimed by the active Typert Gateway share `/api/<method>`. Both paths retain the `ClientRequest` and `ServerResponse` envelope, rpcId correlation, local principal, JSON media-type requirement, and cancellation signal. A slash endpoint not claimed by the Gateway remains a 404 and is never forwarded to a cloud Host. `/api/events.mux` and `/api/events.host` are downlink-only WebSocket streams; client messages close the socket with policy error 1008.

## Model Experience

### Local RPC carrier

#### What the model sees

Nothing. The `ClientRequest` and event-frame carrier never contributes prompt content, tool schemas, or tool results.

#### Token effect

None; the package neither assembles nor sends a provider request.

#### KV Cache effect

None; the carrier contributes no model-visible content, so it cannot change a cache key.

## Known Limitations and Deferred Work

- **Loopback only** — the carrier deliberately has no external bind option, TLS, account authentication, or cloud fallback. A network-accessible deployment must use the account-aware remote Host instead.
- **One listener per plugin instance** — port allocation and process supervision belong to the desktop local-runtime supervisor; the carrier does not discover or replace another running Worker.
