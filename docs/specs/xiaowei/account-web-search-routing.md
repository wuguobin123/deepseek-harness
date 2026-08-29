---
sdd:
  id: feature.xiaowei.account-web-search-routing
  kind: feature
  status: approved
  owners:
    - xiaowei-platform
    - web-platform
  requirements:
    - id: REQ-xiaowei-account-web-search-routing-001
      text: A signed-in local Workspace uses the authenticated production Host's configured Web search capability without requiring or receiving a provider credential on the device.
    - id: REQ-xiaowei-account-web-search-routing-002
      text: The account Web search request carries only a bounded query and result limit; the production Host derives account ownership from the bearer principal and rejects caller-supplied account, Workspace, Session, path, file-reference, provider, and credential fields.
    - id: REQ-xiaowei-account-web-search-routing-003
      text: Electron retains the bearer and relays search between the device Worker and the account RPC, while the local Agent loop, Session log, files, Shell, Skills, approvals, artifacts, and tool-result continuation remain in the device Host.
    - id: REQ-xiaowei-account-web-search-routing-004
      text: Cancellation, sign-out, account switching, authentication expiry, malformed frames, crossed request identifiers, provider failure, and cloud unavailability terminate only the affected search and never fall back to a local provider credential or move the local Session to the cloud.
    - id: REQ-xiaowei-account-web-search-routing-005
      text: Cloud Workspace search keeps the production Host's existing provider selection, credentials, safety policy, result format, and model-facing tool schema.
  acceptance:
    - id: ACC-xiaowei-account-web-search-routing-001
      text: Account RPC schema and service checks prove principal-derived ownership, authenticated access, bounded requests and results, provider-error preservation, cancellation, and rejection of every forbidden identity, local-resource, provider, and credential field.
      evidence: []
    - id: ACC-xiaowei-account-web-search-routing-002
      text: Device Provider and Electron checks prove concurrent request correlation, cancellation, malformed and crossed-frame rejection, bearer confinement to Electron, and exact propagation of structured search results and failures.
      evidence: []
    - id: ACC-xiaowei-account-web-search-routing-003
      text: An assembled keyless device runtime with no DEEPSEEK_API_KEY executes web_search through a scripted authenticated parent, records the returned sources in the local Session, and retains the local filesystem, Shell, and Skill capability roster.
      evidence: []
    - id: ACC-xiaowei-account-web-search-routing-004
      text: Production and packaged-client acceptance proves that cloud Workspace Web search still succeeds, a signed-in local Workspace returns a cited URL through web_search, and a subsequent local file write changes the original device directory without creating a cloud Workspace or Session.
      evidence: []
  evidence: []
  decisions:
    - .agents/notes/proposed/architecture/2026-08-27-xiaowei-account-web-search-routing.md
    - .agents/notes/proposed/architecture/2026-08-27-workbuddy-federated-desktop.md
    - .agents/notes/implemented/architecture/2026-06-24-web-capability-seam.md
---
# Account-routed Web search for local Workspaces

English | [中文](account-web-search-routing.zh.md)

## Outcome

A signed-in Xiaowei local Workspace searches through the account production Host while its Agent and execution effects remain on the device. The user does not configure a separate device search key, and the device never receives the production provider credential.

## Requirements

### REQ-xiaowei-account-web-search-routing-001 through REQ-xiaowei-account-web-search-routing-005

The frontmatter owns the observable requirements. Search is one explicit account RPC rather than a generic remote-tool channel: the device sends bounded search input, Electron supplies the existing authenticated transport, and the production Host applies its configured `ctx.web` provider policy.

## Acceptance

### ACC-xiaowei-account-web-search-routing-001 through ACC-xiaowei-account-web-search-routing-004

Protocol, device Provider, Electron, assembled runtime, production service, and installed-client checks prove distinct layers. A source or unit check cannot satisfy the packaged local-Workspace result.

## Decisions

The [account Web search routing decision](../../../.agents/notes/proposed/architecture/2026-08-27-xiaowei-account-web-search-routing.md) owns the capability-specific transport and security choices. The [federated desktop proposal](../../../.agents/notes/proposed/architecture/2026-08-27-workbuddy-federated-desktop.md) owns Host federation and device execution. The [Web capability decision](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.md) owns stable tools and Host-selected providers.
