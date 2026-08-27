# attachment/ - durable attachment capability family

English | [中文](README.zh.md)

The durable binary attachment seam and its local filesystem implementation. Both are product packages.

| Package | Role | ctx key |
|---|---|---|
| `attachment/` | Immutable image and document references, upload limits, and storage service | `ctx.attachments` |
| `attachment-local/` | Content-addressed private image, PDF, and Office storage below `DSH_HOME` | (registers on `ctx.attachments`) |

Unsent browser drafts are intentionally outside this capability. Bytes enter durable storage only when a user prompt is submitted or when a provider adapter commits structured model output.
