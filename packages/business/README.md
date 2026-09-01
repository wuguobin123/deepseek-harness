# business/ — account-private declarative business Skills

English | [中文](README.zh.md)

This family publishes versioned business-operation manifests per authenticated account and executes their bounded HTTPS requests through one stable model-facing tool.

| Package | Role | ctx key |
|---|---|---|
| [`skill/`](skill/README.md) | Defines manifest validation, immutable revisions, activation, disablement, rollback, and account-filtered resolution | `ctx.businessSkills` |
| [`skill-sqlite/`](skill-sqlite/README.md) | Persists account-private manifests and active-version pointers in SQLite | provides `ctx.businessSkills` |
| [`connector/`](connector/README.md) | Defines trusted principals and named business-connector resolution | `ctx.businessConnectors` |
| [`connector-http/`](connector-http/README.md) | Executes allowlisted HTTPS GET operations with referenced deployment credentials | registers on `ctx.businessConnectors` |
| [`runtime/`](runtime/README.md) | Projects active manifests into the Skill catalog and exposes `business_skill_call` | registers on `ctx.skills` and `ctx.tools` |
| [`gateway/`](gateway/README.md) | Runs reviewed business reads and hot-loaded dynamic grants independently from the Xiaowei Host | standalone loopback service |

The model supplies only the Skill name, operation, and business input. The Host derives the account from the authenticated RPC principal or durable Session owner. The runtime rejects identity, token, role, and scope fields in manifests and tool arguments; the connector adds trusted identity and permission headers, while the business service makes the authoritative operation-permission decision.

`tenantId` is omitted until Xiaowei has an authoritative tenant membership and tenant-selection source. It must never be accepted from a manifest, browser request, user prompt, or model tool call.
