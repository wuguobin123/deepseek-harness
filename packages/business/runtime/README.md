# Business Skill Runtime

English | [中文](README.zh.md)

Stable `business_skill_call` dispatcher derives the owner from trusted context and checks the active version, operation, connector, and credential policy before I/O. An operation uses a deployment credential only when it explicitly names an approved `credentialRef`; the runtime never defaults to another manifest reference. The HTTPS connector passes the trusted user id and required permission to the business API, which performs the authoritative business permission check.

## Model Experience

### Stable dispatcher

#### What the model sees

The stable `business_skill_call` schema, selected account Skill guidance, and a validated bounded business result. Identity, tenant, credentials, authorization headers, and audit metadata remain hidden.

#### Token effect

One stable Tool schema plus data-dependent selected Skill guidance and successful result JSON.

#### KV Cache effect

The stable Tool schema remains cacheable; a later active-revision change can replace only the selected Skill guidance and result suffix.

## Known Limitations and Deferred Work

- Input and output schemas use the repository's enforced JSON Schema subset; transformations and schema keywords outside that subset require a reviewed connector or runtime extension.
