# Agent Note: Declarative business Skill runtime

Status: implemented

English | [中文](2026-09-01-declarative-business-skill-runtime.zh.md)

## Problem

Account Skills currently store Markdown instructions, while account plugin installation selects deployment-owned executable activators for later Sessions. Neither path can publish a new business API operation as account-scoped configuration that becomes available without Host restart or source deployment. Allowing definitions to provide executable code, arbitrary endpoints, credentials, or identity fields would move account isolation and network authority into caller-controlled data.

## Decision

Deploy one stable business runtime containing a versioned definition service, account-filtered Skill provider, stable model-facing dispatcher tool, required-permission propagation, approved connector providers, and secret-free audit. Later business integrations publish data-only manifests that reference approved connections and declare closed operations, schemas, permissions, read-only risk, and response limits. Retry and audit behavior remain platform policy rather than caller-controlled manifest fields.

The authenticated principal and durable Session owner remain the only account selectors. Model and user input cannot provide or override identity, tenant, role, credential, or authorization fields. The runtime resolves one immutable active version at dispatch, validates its operation and schemas, resolves credentials immediately before connector execution, and records only bounded metadata about the decision and outcome. The connector passes Host-derived user identity and the operation's required permission to the business API, which performs the authoritative user-permission check.

Publishing validates the complete manifest before a transaction writes an immutable version and advances the active pointer. The commit refreshes the Skill registry, so the next lookup observes the version without recomposing the Agent. Disable and rollback change the pointer; calls already dispatched retain their resolved version, while emergency disable blocks new dispatch.

## Alternatives considered

**Install each business integration as a Cordis code plugin.** This preserves arbitrary implementation freedom but requires deployment and Session composition changes for every integration, so it does not meet the configuration-only lifecycle.

**Generate one dynamic model-facing tool per configured operation.** This gives each operation a semantic tool name but changes tool schemas inside live Sessions and complicates replay. One stable dispatcher keeps the request header stable; the durable Skill catalog carries the configured operation guidance.

**Allow manifests to contain arbitrary URLs, headers, SQL, or scripts.** This would make configuration an execution and network-authority channel. Connections and credential references remain separately approved, and connectors enforce protocol-specific limits.

**Forward the Xiaowei bearer to the business endpoint.** The account session token has the wrong audience and would expose reusable login authority. Connectors use a service credential or audience-limited grant resolved on the server.

## Testing

An authenticated account can publish, discover, execute, disable, and roll back a data-only business Skill without Host restart. Focused checks prove principal-derived ownership, reserved-field rejection, schema enforcement, required-permission propagation, last-good retention, connector limits, durable secret-free audit, current-Session catalog refresh, and cloud-only desktop routing for every business Skill administration RPC. The packaged desktop composition also activates the business Skill management tab. The [business metrics acceptance](../../../../docs/ops/xiaowei-business-metrics-acceptance.md) records separate real-endpoint and installed-client evidence for the first production integration.

## Risks

The stable dispatcher is intentionally more general than a semantic per-operation tool, so every execution path must resolve the account-owned active definition, validate the exact operation, and propagate its required permission before I/O. Global Skill registry invalidation may do excess work as account count grows; changing it to owner-scoped invalidation requires a separate registry contract. Credential storage for user-owned OAuth grants is outside the first service-credential provider and must not be approximated with plaintext configuration.

## Consequences

The first deployment adds platform code and requires one ordinary service restart. Subsequent supported business integrations publish configuration, switch versions, disable, and roll back without source changes or restart. Protocols not implemented by an approved connector and custom executable transformations remain outside the manifest; they run in a separately deployed business gateway or require a new reviewed connector provider.

The stable tool can name any configured Skill and operation, so the business API's authorization decision over the trusted user identity and required permission is mandatory. Skill visibility and prompt instructions do not grant access. Multi-tenant bindings remain unavailable until an authoritative membership service can derive the active tenant from authenticated server state.
