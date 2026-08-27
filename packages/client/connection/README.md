# @deepseek-ai/dsh-client-connection

English | [中文](README.zh.md)

Wire consumer layer: the client plugin's apply mounts `ctx.connection` (shared API client, connected-Host loopback state, observable generation-scoped `hostDescription`, and a single-consumer stream-loop starter); the export face carries wire types, the `AbstractApiClient` abstraction, and loop sink/config types. Each successful readiness handshake publishes the exact `host.describe` value before `onConnected`; generation loss and explicit stop clear it. The browser carrier uses HTTP POST for unary and respond operations and opens one downlink-only WebSocket each for `events.mux` and `events.host`; the in-process carrier satisfies the same abstraction. The exported `ClientTransportHooks` page global `__DSH_TRANSPORT__` replaces that carrier wholesale for shells such as the worker preview and Electron desktop and reports whether its target Host is loopback when the shell page URL does not carry that authority. The Host half owns the `/api` route and Fetch bridge; a registered Typert interceptor claims its Remote endpoints before the API Proxy fallback. The platform carriers and `ConnectionController` loop remain package-internal. The downlink behavior is documented in the [WebSocket downlink carrier Agent Note](../../../.agents/notes/implemented/architecture/2026-08-04-websocket-downlink-carrier.md).

The node half keeps operations that act on the server machine (`host.pickDirectory`, `host.openPath`, `settings.openDocument`, and `agentPreset.openDocument`) loopback-only. Settings reads and writes, credential reads and writes, `llm.discoverModels`, and agent-preset read/copy/remove also remain loopback-only when no identity service is mounted. With identity enabled, an account bearer may reach that configuration set through a declared `trustedHosts` authority; anonymous callers still receive 403. `agentPreset.list` and `agentPreset.select` remain ordinary authenticated methods because their ids and selection grant no capability beyond `session.create`'s `agentPreset` field.

## /api browser-trust fence

The node half guards every entry under `/api` before bridging or upgrading (`src/api-request-trust.ts`). Every request — browser-marked or not — must present a `Host` that is loopback or matches a `trustedHosts` entry: exact on `host:port` entries, any port on port-less entries, both sides compared through WHATWG normalization. There is no shortcut for unmarked HTTP requests because a browser may omit both `Origin` and Fetch Metadata on plain-HTTP reads; the Host check is the DNS-rebinding defense. When browser markers are present, `Origin` must equal the Host authority and `sec-fetch-site: cross-site` is refused. Malformed or non-canonical `trustedHosts` entries fail plugin load. HTTP failures answer plain 403 before RPC dispatch, and upgrade failures reject the WebSocket handshake before a stream starts. Authentication never bypasses this authority check. The served Web carrier does not inject a bearer; an account-aware shell such as the desktop transport owns that credential. Decision record: [the API browser-trust boundary Agent Note](../../../.agents/notes/implemented/architecture/2026-07-28-api-browser-trust-boundary.md).

## `/api` WebSocket downlinks

`/api/events.mux` and `/api/events.host` each accept a WebSocket upgrade and send only the corresponding `ServerRequest` text messages to the browser; the client sends no application data over these sockets. If either socket ends, the current connection generation fails and rebuilds both streams; readiness still requires both sockets to be open and the `host.describe` HTTP call to succeed. Host teardown terminates both sockets, aborts their sources, and waits for source cleanup before returning. Ordinary network GETs to these paths return 426 with no SSE fallback; `toFetchHandler`'s SSE codec serves only the isomorphic in-process carrier.

## Account principal

When the mounted account service is enabled, bearer authentication resolves the token to an account `userId` and carries that principal through unary HTTP, downloads, responses, and both WebSocket downlinks. A valid bearer remains the account principal for ordinary loopback RPCs, so signed-in desktop Sessions retain their owner; a bearer-free loopback request remains the local management principal. Methods that act on the server machine also preserve the local principal on loopback when a bearer is present. Account signup, signin, verification-code, state, and signout remain callable before authentication on a declared authority, while other remote requests require a valid bearer. Configuration methods additionally require either loopback or a declared authority, while operations acting on the server machine remain loopback-only. A token change creates a new desktop connection generation: the shell aborts and awaits both old downlinks before installing or clearing the token, preventing an account switch from retaining frames from the previous account.

## Model Experience

None, as the wire consumer layer moves already-composed messages between browser and host; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **History resumes an unattached session** — opening history may create the host-side agent and add latency to the first open; there is no persistence-only read path.
- **The `/api` bridge buffers each request body in memory** — `maxRequestBodyBytes` (default 300 MiB, sized for the default 200 MiB aggregate image limit after base64 expansion plus envelope headroom) is therefore also the per-request resident bound; a streaming body path would be needed to lower it without shrinking the image limits.
