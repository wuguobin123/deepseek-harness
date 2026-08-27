# knowledge/ — tenant-scoped knowledge capability family

English | [中文](README.zh.md)

This family implements the private-knowledge retrieval seam from bounded ingestion through cited model-facing search.

| Package | Role | ctx key |
|---|---|---|
| [`knowledge/`](knowledge/README.md) | Defines tenant-and-subject-scoped knowledge-base, ingestion, deletion, and search operations | `ctx.knowledge` |
| [`knowledge-sqlite-local/`](knowledge-sqlite-local/README.md) | Provides local SQLite FTS5 and vector retrieval | registers on `ctx.knowledge` |
| [`tool-knowledge/`](tool-knowledge/README.md) | Exposes cited private-knowledge search to the current session owner | registers on `ctx.tools` |

The model never supplies tenant or subject identifiers. A trusted caller derives the complete scope before invoking `ctx.knowledge`; the provider applies it to every storage and retrieval operation.
