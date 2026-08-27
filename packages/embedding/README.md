# embedding/ — embedding capability family

English | [中文](README.zh.md)

This family separates provider-neutral embedding requests from concrete vector implementations.

| Package | Role | ctx key |
|---|---|---|
| [`embedding/`](embedding/README.md) | Defines embedding provider registration, selection, vector identity, and query/document operations | `ctx.embedding` |
| [`embedding-hash-local/`](embedding-hash-local/README.md) | Provides deterministic offline vectors for tests and local development | registers on `ctx.embedding` |

Production semantic embedding adapters can replace the local hash provider without changing Knowledge Consumers. Vector-space identity includes model, revision, and dimensions so indexes can reject incompatible vectors.
