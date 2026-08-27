# Agent Note: Desktop downlink failures remain visible to reconnect logic

Status: implemented

English | [中文](2026-08-25-desktop-downlink-reconnect.zh.md)

## Problem

The Electron main process converted a failed WebSocket carrier into an IPC `stream/error` frame, but the renderer transport discarded that frame. Its async iterator therefore remained pending after the physical carrier had ended, so `ConnectionController` could not observe stream completion and reconnect. The main process also treated 90 seconds without application events as a dead connection, even though an inactive workspace can legitimately remain quiet for longer. Removing that deadline exposed the opposite failure: a silently blackholed TCP connection remained `ESTABLISHED`, unary prompts completed, and the cached open Session never received the resulting events.

## Decision

The desktop WebSocket carrier tests transport liveness with protocol ping/pong frames instead of application events. Each mux and host connection sends a ping every 30 seconds and requires a pong or another inbound frame within 10 seconds. A missed deadline terminates the carrier with `HEARTBEAT_TIMEOUT`. The main process emits the resulting failure as a schema-valid `stream/error` envelope with a non-empty correlation id, the protocol's `internal` code, and the transport failure message. The renderer validates and yields that frame like the web transport, allowing `ConnectionController` to end the current generation, reconnect both carriers, and run its normal state resynchronization.

## Alternatives considered

- **Reconnect inside the Electron main process** — rejected because `ConnectionController` already owns paired mux/host generations, retry backoff, state transitions, and post-connect resynchronization. A second reconnect loop would split lifecycle ownership.
- **Keep the 90-second idle deadline and rely only on reconnect** — rejected because it would deliberately churn healthy connections whenever a workspace is quiet, creating avoidable gaps and server load.
- **Leave the carrier without an idle deadline or heartbeat** — rejected because TCP `ESTABLISHED` is not proof that downstream frames still traverse the path; a renderer reload should not be required to discover a silent blackhole.
- **Continue dropping `stream/error` and add a separate IPC close event** — rejected because the existing frame union and connection controller already define the terminal signal needed by both transports.

## Consequences

- Quiet desktop sessions keep their established WebSocket carriers while pong frames prove transport liveness.
- Network failures, heartbeat timeouts, and unexpected clean closes converge on the existing reconnect and live-gap repair path.
- Desktop transport tests pin silent-blackhole detection, healthy quiet connections, the main-process terminal envelope, and renderer delivery to the connection layer.
