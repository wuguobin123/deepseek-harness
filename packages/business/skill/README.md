# Business Skill

English | [中文](README.zh.md)

Account-scoped data-only Skill definitions with versioned publish, active lookup, disable, and rollback. The model sees only operation guidance; credentials and identity are server-side.

## Model Experience

### Active business Skill

#### What the model sees

The `business_skill_call` consumer may render an active definition's description, operation ids, business input schemas, required-permission names, and read-only risk marker as selected Skill guidance.

#### Token effect

Data-dependent on the selected active definition; inactive and other-account revisions contribute no tokens.

#### KV Cache effect

Publishing, disabling, or rolling back invalidates the Skill catalog for the next lookup and may replace the later model-context suffix without rewriting an active request.

## Known Limitations and Deferred Work

- Multi-tenant membership and writable operations are deferred; the first release supports R1 reads.
