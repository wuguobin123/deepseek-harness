---
sdd:
  id: feature.xiaowei.business-skill-hot-loading
  kind: feature
  status: implemented
  owners:
    - xiaowei-platform
  requirements:
    - id: REQ-xiaowei-business-skill-hot-loading-001
      text: Every business Skill lookup and operation derives the account from the authenticated principal or durable Session owner, and user or model arguments cannot supply or override userId, tenantId, credentials, or authorization fields.
    - id: REQ-xiaowei-business-skill-hot-loading-002
      text: An authenticated account can validate, publish, disable, and roll back a versioned data-only business Skill definition without restarting the Host or changing deployed source code.
    - id: REQ-xiaowei-business-skill-hot-loading-003
      text: A successful publish becomes visible to the account on the next Skill lookup, while a failed publish preserves the last active version and an in-flight operation retains the version resolved at dispatch.
    - id: REQ-xiaowei-business-skill-hot-loading-004
      text: The model reaches configured operations only through one stable business tool whose executor repeats installation, active-version, operation, schema, connection, and credential-policy checks before external I/O and passes the required permission to the business API.
    - id: REQ-xiaowei-business-skill-hot-loading-005
      text: Business Skill definitions contain credential references and approved connection ids only; resolved credential values and authenticated identity fields never enter model messages, tool arguments, configuration responses, or audit payloads.
  acceptance:
    - id: ACC-xiaowei-business-skill-hot-loading-001
      text: Focused service and executor tests reject reserved identity fields, invalid schemas and inputs, cross-account lookup, disabled definitions, and stale revisions, and prove trusted identity and required-permission propagation.
      evidence:
        - packages/business/skill-sqlite/tests/skill-sqlite.spec.ts
        - packages/business/runtime/tests/runtime.spec.ts
        - packages/business/connector-http/tests/connector-http.spec.ts
    - id: ACC-xiaowei-business-skill-hot-loading-002
      text: An assembled runtime publishes a definition, refreshes the account Skill catalog for the next step without process replacement, retains the last active version after invalid input, and rolls back by switching the active version.
      evidence:
        - apps/cli/tests/web-agent-presets.e2e.ts
    - id: ACC-xiaowei-business-skill-hot-loading-003
      text: Authenticated RPC and client checks derive ownership from the principal and expose versioned definitions without account ids, credential values, or authorization headers.
      evidence:
        - packages/host/apiproxy/tests/api-proxy-business-skills.spec.ts
        - packages/host/apiproxy/tests/client-handler.spec.ts
    - id: ACC-xiaowei-business-skill-hot-loading-004
      text: The Xiaowei configuration surface validates, publishes, disables, and rolls back one business Skill and reports the active version and validation failures.
      evidence:
        - packages/client/ui-settings-business-skills/tests/components.client.spec.tsx
        - packages/client/ui-settings-business-skills/tests/browser-plugin.client.spec.tsx
  evidence:
    - packages/business/skill/src/index.ts
    - packages/business/skill-sqlite/src/index.ts
    - packages/business/runtime/src/index.ts
    - packages/business/connector-http/src/index.ts
    - packages/host/apiproxy/src/api-proxy.ts
  decisions:
    - .agents/notes/implemented/architecture/2026-09-01-declarative-business-skill-runtime.md
    - docs/architecture.md
---
# Xiaowei business Skill hot loading

English | [中文](business-skill-hot-loading.zh.md)

This feature adds an account-scoped, data-only business Skill runtime. The platform code, stable model-facing tool, connection providers, authorization checks, and storage service are deployed once; later business definitions are validated and published as versioned configuration.

## Runtime rules

The authenticated principal and durable Session owner are the only account selectors. Business operation input schemas reject reserved identity and credential names, and the runtime injects trusted identity only after resolving the current account. The approved connector sends the trusted identity and the operation's required permission to the business API, which makes the authoritative user-permission decision.

Publishing first validates the complete definition and every referenced connection, then writes an immutable version and advances the active pointer in one transaction. A successful commit refreshes the Skill registry. Disable and rollback update the active pointer without loading executable code, while failed validation leaves the last active version unchanged.

The stable `business_skill_call` tool accepts only a Skill name, an operation id, and operation-specific business input. It resolves one active version, validates the declared input schema, obtains credentials at the operation boundary, executes through an approved connector, validates and bounds the response, and records a secret-free audit result.

## Verification

Focused checks cover parser, persistence, Tool execution, connector policy, authenticated RPC, and the Settings client. The assembled keyless Xiaowei runtime proves that publish, failed-update retention, account isolation, disable, and rollback change the next Skill lookup without process replacement.
