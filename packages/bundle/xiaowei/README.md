# `@deepseek-ai/dsh-xiaowei`

English | [中文](README.zh.md)

The Xiaowei multi-user profile bundle layers authenticated account services, owner-scoped workspace roots, wallet and model-key storage, artifacts, search providers, and the remote desktop carrier over the shared base composition. Account roots derive from `XIAOWEI_ACCOUNT_WORKSPACE_ROOT` (or `DSH_HOME/account-workspaces`) and a SHA-256 account id; same-host shell, raw filesystem, workflow, and delegated execution tools remain disabled.

The Xiaowei-safe agent composition mounts the `skill_install` tool when the account skill store is present. A successful conversational installation writes one `SKILL.md` under an opaque account-hash directory and refreshes the skill registry for the next lookup. The client never chooses a server module, activation id, filesystem path, configuration body, or account id; all ownership comes from the authenticated principal and the session header created for that principal.

The same composition exposes `web_search` and `web_fetch` independently of the Session's conversation model. Search uses Firecrawl with loopback SearXNG as its missing-credential fallback. Fetch uses the DNS-pinned public HTTP provider first and tries Firecrawl only after a safely retrieved HTTP 403 or 429 response; a Firecrawl credential is therefore optional for ordinary public pages and raw files.

## Hot-loaded business Skills

The platform mounts the business Skill runtime once. After that deployment, a signed-in account can publish, validate, disable, or roll back a data-only manifest from Settings → Plugins → Business Skills without changing platform source or restarting the service. Publishing atomically creates an immutable revision, moves the active pointer, and refreshes the Skill catalog for the next model step; a failed validation or revision conflict retains the last-good revision.

The deployment allowlist is configured with `XIAOWEI_BUSINESS_SKILL_HOSTS` and `XIAOWEI_BUSINESS_SKILL_CREDENTIAL_REFS`. A manifest may select only an HTTPS URL on an approved host and a credential reference approved for that connector. The credential value is resolved per operation and never enters the manifest, browser response, model arguments, or audit event. Adding an entirely new trust domain or credential reference is an operator security-policy change; ordinary Skills on already approved domains are configuration-only and hot-loaded.

The Xiaowei metrics endpoint uses `XIAOWEI_BUSINESS_API_CREDENTIAL_REF` to select its server-side credential and `XIAOWEI_BUSINESS_METRICS_GRANTS` as a JSON object from authenticated user ids to permission arrays. `XIAOWEI_BUSINESS_SKILL_RETRIES` sets connector retries from zero through five, and the server writes every permitted or denied metrics decision to `business-metrics-audit.jsonl` below `DSH_HOME`. The grants file is deployment policy: clients and manifests cannot add themselves or provide an identity value.

`userId` and `tenantId` are reserved recursively in every manifest and Tool input. The Tool accepts only `skill`, `operation`, and business `input`; the runtime derives `userId` from the authenticated Session and sends it to the business API as `X-Xiaowei-User-Id`. The business API first authenticates the connector bearer credential, then checks `X-Xiaowei-Required-Permission` for that trusted user before querying data. Xiaowei does not currently have an authoritative tenant-membership selection, so this release does not emit `tenantId` rather than inventing or accepting one.

```yaml
name: xiaowei-metrics
version: 1.0.0
description: Query registered-account and share-code usage totals.
connectionIds:
  - https://business.example.com/api/
credentialRefs:
  - XIAOWEI_BUSINESS_API_TOKEN
operations:
  - id: registered-accounts
    method: GET
    path: /metrics/registered-accounts
    input: { type: object, additionalProperties: false }
    output: { type: object, properties: { count: { type: integer }, observedAt: { type: string } }, required: [count, observedAt], additionalProperties: false }
    permission: metrics.accounts.read
    connection: https://business.example.com/api/
    credentialRef: XIAOWEI_BUSINESS_API_TOKEN
    risk: R1
  - id: share-code-usage
    method: GET
    path: /metrics/share-code-usage
    input: { type: object, additionalProperties: false }
    output: { type: object, properties: { count: { type: integer }, observedAt: { type: string } }, required: [count, observedAt], additionalProperties: false }
    permission: metrics.share-codes.read
    connection: https://business.example.com/api/
    credentialRef: XIAOWEI_BUSINESS_API_TOKEN
    risk: R1
```

The `tool-capabilities` export is the machine-readable manifest for the shipped local and cloud presets. It names shared tools, location-only tools, and permitted location-aware descriptions. The assembled profile test reads the registered definitions and compares each shared input and output schema, timeout, presentation callbacks, and concurrency classification; it rejects an undeclared difference. A location-aware description may differ only when the manifest declares it, so the model can see whether persistent data belongs to the computer or the account.

## Model Experience

### Installed account capabilities

#### What the model sees

The bundle contributes no model-visible text directly. Its preset exposes stable web tool schemas whose host-selected providers do not change with the conversation model. Mounted plugin activators may add tools to newly created account Sessions; restoration and forks preserve the selection recorded by that Session. `skill_install` exposes a tool schema that lets the model persist a user-approved skill. Installed skill content enters a later model request only when the skill lookup and invocation path selects it.

#### Token effect

Data-dependent on the installed plugin tools and on any account Skill selected for a later request; the bundle contributes no prompt tokens by itself.

#### KV Cache effect

Plugin selections can change the tool-schema prefix of later agent instances. Installing a skill does not rewrite an active request; later skill selection may add the stored instructions to that request's context.

## Known Limitations and Deferred Work

- Plugin selections do not hot-recompose an already running Agent; create a new session or cold-restore the session to apply them.
- The plugin catalog and activators are deployment code, not a remote marketplace feed.
- Xiaowei currently publishes only its deployment-safe `core-tools` catalog entry. The generic optional-plugin mechanism remains available to other deployments, but Xiaowei does not publish a host-execution activator until account isolation for that capability is available.
- Account skills are local to one Xiaowei host. Replication, version history, review workflow, and cross-device synchronization are not implemented.
- Delegated child agents currently inherit the preset composition, not optional activators attached to the parent Agent's exact scope.
- Business Skills support read-only `GET` operations. Write operations, user OAuth, and tenant identity remain closed until their authorization and approval contracts are implemented.
