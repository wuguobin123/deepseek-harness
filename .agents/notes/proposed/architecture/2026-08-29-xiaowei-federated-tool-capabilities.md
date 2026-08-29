# Agent Note: Xiaowei federated tool capabilities

Status: proposed

English | [中文](2026-08-29-xiaowei-federated-tool-capabilities.zh.md)

## Problem

Xiaowei local and cloud workspaces need to expose the same tools without making one Host execute, store state for, or apply side effects on behalf of the other. A generic remote tool path would blur location ownership, weaken authorization, and make failures indistinguishable from local execution. Static registration alone also cannot prove that both assembled Hosts execute the same `web_search` contract.

## Proposal

Define a federated tool capability around a shared manifest contract: exact tool name, input and result schemas, render intent, error taxonomy, and risk classification. Each Host owns execution, runtime state, data, credentials, and side effects for its location.

Cross-Host operations use only narrow typed relays. A relay names its destination location, allowlists its fields, and has explicit authorization, serialization, cancellation, and error semantics. No generic remote tool bus, dynamic forwarding, or untyped proxy is available.

Routing fails closed for missing, unsupported, ambiguous, unauthorized, or non-parity locations. A manifest/parity gate compares the shared contract before assembly. `web_search` is the exact assembled regression: both Hosts must expose the same contract and pass success and failure execution checks.

Acceptance records keyless source and assembled evidence separately from installed-client and release evidence. The latter remain unclaimed until real installed and published surfaces are observed.

## Alternatives considered

**Generic remote tool bus.** Rejected because arbitrary forwarding transfers execution and authorization decisions across Hosts and makes side effects difficult to attribute.

**Duplicate independent tool definitions.** Rejected because schema, rendering, error, and risk drift would be detected only after clients diverge; the manifest/parity gate makes the shared fields explicit.

**Client-side fallback to the other Host.** Rejected because an unavailable or unauthorized location must fail closed, not silently change data ownership or execution location.

## Acceptance criteria

- Keyless source checks compare the shared manifest fields and reject each parity mismatch.
- Assembled checks prove typed relay limits, Host-local execution/state/data/side effects, and fail-closed routing.
- The exact `web_search` regression exercises matching success and failure behavior on local and cloud Hosts.
- Reports distinguish keyless source/assembled checks from installed-client and release evidence and make no unobserved installation or production claim.

## Risks

Shared manifest fields can become too restrictive for genuinely Host-specific behavior; such behavior must be a separate capability or an explicitly typed Host-owned field rather than an implicit exception. Relay definitions add serialization and cancellation maintenance. Source and assembled checks still cannot prove an installed release, so release promotion requires separate real-client evidence.
