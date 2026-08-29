---
sdd:
  id: capability.xiaowei.federated-tool-capabilities
  kind: capability
  status: approved
  owners:
    - xiaowei-platform
  requirements:
    - id: REQ-xiaowei-federated-tool-capabilities-001
      text: Local and cloud Hosts publish the same capability manifest entries for a shared tool name, input schema, result schema, render intent, error taxonomy, and risk classification.
    - id: REQ-xiaowei-federated-tool-capabilities-002
      text: Each Host owns execution, runtime state, data access, and side effects for its location; a tool call cannot transfer ownership of those resources to the other Host.
    - id: REQ-xiaowei-federated-tool-capabilities-003
      text: Cross-Host communication is limited to explicitly typed relays whose request and result types name the destination location and whose fields are allowlisted for that capability.
    - id: REQ-xiaowei-federated-tool-capabilities-004
      text: The runtime does not provide a generic remote tool bus, dynamic tool forwarding, or an untyped proxy that can execute arbitrary capabilities on the other Host.
    - id: REQ-xiaowei-federated-tool-capabilities-005
      text: Location routing fails closed when a location is absent, unsupported, ambiguous, unauthorized, or missing a manifest-parity declaration; no call executes on a fallback Host.
    - id: REQ-xiaowei-federated-tool-capabilities-006
      text: A manifest and parity gate rejects a Host composition when the shared tool contract differs in name, schema, result, render intent, error taxonomy, or risk classification.
    - id: REQ-xiaowei-federated-tool-capabilities-007
      text: The assembled regression for web_search asserts the exact shared tool name and contract on both local and cloud Hosts, including its render and failure behavior.
    - id: REQ-xiaowei-federated-tool-capabilities-008
      text: Acceptance reports distinguish keyless source and assembled evidence from installed-client and release evidence, and does not claim installed or production behavior without those observations.
  acceptance:
    - id: ACC-xiaowei-federated-tool-capabilities-001
      text: A keyless source check proves that local and cloud manifest entries for a shared tool have byte-equivalent contract fields and location-specific Host ownership metadata.
      evidence: []
    - id: ACC-xiaowei-federated-tool-capabilities-002
      text: An assembled Xiaowei composition runs one typed relay per declared cross-Host operation, rejects arbitrary capability forwarding, and leaves execution, state, data, and side effects on the destination Host.
      evidence: []
    - id: ACC-xiaowei-federated-tool-capabilities-003
      text: Focused routing checks reject missing, unsupported, ambiguous, and unauthorized locations without invoking either Host as a fallback.
      evidence: []
    - id: ACC-xiaowei-federated-tool-capabilities-004
      text: The manifest/parity gate rejects each independently changed shared contract field and accepts matching local/cloud declarations.
      evidence: []
    - id: ACC-xiaowei-federated-tool-capabilities-005
      text: The assembled web_search regression checks the exact tool name, input and result schemas, render intent, error taxonomy, risk classification, and successful and failed calls on both Hosts.
      evidence: []
    - id: ACC-xiaowei-federated-tool-capabilities-006
      text: The acceptance report labels source and assembled checks as keyless evidence and leaves installed-client and release evidence pending until real installed and published surfaces are observed.
      evidence: []
  evidence: []
  decisions:
    - .agents/notes/proposed/architecture/2026-08-29-xiaowei-federated-tool-capabilities.md
    - docs/architecture.md
---

# Xiaowei federated tool capabilities

English | [中文](federated-tool-capabilities.zh.md)

## Capability

This capability gives Xiaowei local and cloud Hosts one discoverable tool vocabulary while keeping each location's execution and data ownership independent. The capability owner is `xiaowei-platform`; the local and cloud Host implementations own their respective runtime state and side effects.

## Shared tool contract

Each shared capability is declared by a manifest entry containing the exact `name`, input JSON Schema, result JSON Schema, render intent, error taxonomy, and risk classification. Render intent is data, not a client-side reinterpretation; error and risk fields are part of the model-visible contract. Local and cloud entries must agree on these fields before either entry is exposed.

The `web_search` entry is the exact regression exemplar. Its name, schemas, render intent, error taxonomy, and risk classification are compared on both Hosts, and the assembled test exercises both success and failure results. A list entry or static registration does not prove execution.

## Host ownership and relays

The selected Host owns capability execution, mutable runtime state, source data reads and writes, credentials, and side effects. A local call stays local; a cloud call stays cloud. A relay may carry only a declared typed request and its typed result, with an explicit destination location and no arbitrary tool name, module, path, credential, or execution options.

There is no generic remote tool bus. Capabilities that need a cross-Host operation declare a narrow relay type and its authorization, serialization, cancellation, and error behavior. Undeclared forwarding is rejected before execution.

## Routing and parity

Routing requires one explicit location, an authenticated principal authorized for that location, and a manifest entry that passed parity. Missing, unsupported, ambiguous, or unauthorized location data fails closed; the router never retries on or silently selects another Host.

The manifest/parity gate compares the shared contract fields before assembly. Host-owned fields may differ only where the manifest explicitly marks ownership, data location, and execution state; those differences cannot alter the shared tool contract or permit remote side effects.

## Acceptance and evidence

Keyless source checks prove declaration shape, typed relay limits, routing rejection, parity failures, and assembled behavior. They do not prove a packaged Electron client, an installed account/workspace, a published artifact, or production availability. Installed-client and release evidence require the real installed client and the published release surfaces; this specification records no such evidence until those observations exist.

## Decisions

The rationale, rejected alternatives, and consequences are recorded in the [proposed Agent Note](../../../.agents/notes/proposed/architecture/2026-08-29-xiaowei-federated-tool-capabilities.md). Product-wide composition remains governed by [the architecture reference](../../architecture.md).
