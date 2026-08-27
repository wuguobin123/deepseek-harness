# Agent Note: Xiaowei device Remote carrier

Status: implemented

English | [中文](2026-08-27-xiaowei-device-remote-carrier.zh.md)

## Problem

Xiaowei Desktop routes a local Session's generated Remote calls to the loopback device Host. The device carrier exposed only the fixed ApiProxy method table, so valid Typert endpoints such as `commands/list` returned HTTP 404 even though the local service and generated descriptor were active.

## Decision

The device carrier composes the fixed ApiProxy dispatcher with the active Typert Gateway. It asks the Gateway whether a `<namespace>/<method>` endpoint is currently claimed, preserves the existing client-request and server-response envelopes, and dispatches the validated `args` payload through the same helper used by the Web carrier. Unknown slash endpoints remain HTTP 404, and the listener stays bound to `127.0.0.1`.

The Typert Gateway publishes endpoint ownership independently of a physical carrier. Both the Web Connection interceptor and the device carrier use that ownership test, so generated definitions, source-reflection fallback, withdrawal, lookup failures, and cancellation retain one dispatch policy.

## Alternatives considered

**Route generated Remote calls to the production Host.** Rejected because local Session and Agent identifiers are owned only by the device Host; cloud dispatch either fails lookup or breaks execution isolation.

**Add fixed device routes for each generated endpoint.** Rejected because the list would drift whenever a package adds, removes, or withdraws a Remote contribution.

**Run the complete Web carrier in the device process.** Rejected because the device runtime needs loopback unary and event transport, not another renderer, static-file server, or browser plugin composition.

## Consequences

Local commands, goals, file references, message feedback, plugin inventory, and other generated Remotes use their device services through the same desktop connection. The device carrier gains a runtime dependency on the Typert Gateway and must start only after both unary dispatchers are available. Carrier and Gateway tests pin claimed dispatch and unknown-endpoint refusal; installed-client acceptance still proves the packaged dependency closure and renderer behavior.
