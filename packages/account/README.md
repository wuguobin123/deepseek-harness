# Account packages

English | [中文](README.zh.md)

Authenticated-account capabilities used by the Xiaowei multi-user host. Server APIs derive the account from the authenticated principal or durable session owner; browser and model payloads do not select another account.

| Package | Context key / role |
|---|---|
| `account-identity` | `ctx.identity`: invitation-only signup, three owner-scoped referral codes, the 100-account limit, login, and opaque sessions |
| `account-email-verification` | `ctx.emailVerification`: purpose- and invitation-bound verification-code lifecycle |
| `account-model-keys` | account model credentials and revocation |
| `account-wallet` | account balance and ledger |
| `account-plugin-factory` | `ctx.accountPluginFactory`: plugin catalog and installation state |
| `account-skill-store` | `ctx.accountSkillStore`: private Skill publication |
| `tool-skill-install` | model consumer for conversational Skill installation |

Account persistence must key every mutable record by the authoritative user id. System defaults remain deployment-owned and readable by every account without creating per-user rows.
