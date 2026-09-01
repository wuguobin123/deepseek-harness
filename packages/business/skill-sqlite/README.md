# Business Skill SQLite

English | [中文](README.zh.md)

SQLite provider storing immutable Skill revisions and one active pointer per account and Skill. Invalid publishes leave the last active revision unchanged.

## Model Experience

### Storage provider

#### What the model sees

Nothing directly. The `ctx.businessSkill` consumer owns any guidance loaded from revisions returned by this provider.

#### Token effect

None directly; selected definitions affect tokens only through the consuming runtime.

#### KV Cache effect

None directly. The mutation caller refreshes the Skill registry after a committed active-pointer change.

## Known Limitations and Deferred Work

- Schema migrations are intentionally rejected until a versioned migration is approved.
