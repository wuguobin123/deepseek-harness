# Business Connector

English | [中文](README.zh.md)

Defines approved connector and credential-resolution interfaces for business operations.

## Model Experience

### Connector capability

#### What the model sees

Nothing directly. The `ctx.businessConnectors` consumer owns the operation schema and bounded result rendering.

#### Token effect

None directly; connector responses affect tokens only after the consumer validates and renders them.

#### KV Cache effect

None. Connector registration and resolution do not mutate model context.

## Known Limitations and Deferred Work

- Connectors are read-only at the R1 stage.
