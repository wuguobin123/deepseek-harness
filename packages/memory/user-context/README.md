# `@deepseek-ai/dsh-user-context`

English | [中文](README.zh.md)

Model-invisible Xiaowei user-context store. Each `(kind, key, workspaceId?)` tuple owns one string value across Sessions, backed by a private per-deployment SQLite file and exposed as `ctx.userContext`.

## Service surface

Kinds are `preference`, `working`, and `profile`. `get`, `set`, `delete`, and `list` validate bounded keys, values, and optional workspace ids. Global entries use no workspace id; workspace entries do not overwrite their global counterpart. SQLite application and schema versions reject unrelated or unsupported files.

## Model Experience

None, as values are available only to trusted UI and Host consumers and never enter model context.

#### KV Cache effect

None. Stored values are not assembled into prompts or tool results.

## Known Limitations and Deferred Work

- **No model memory consumer.** Automatic extraction, prompt injection, and model-controlled writes are intentionally absent.
- **One local database per deployment.** Replication and cross-host conflict resolution are not implemented.
