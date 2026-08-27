# `@deepseek-ai/dsh-embedding`

English | [中文](README.zh.md)

This package defines `ctx.embedding`, a provider registry for document and query vectors. Provider selection is explicit when configured; otherwise exactly one locally usable provider must exist. Results retain model, revision, and dimensions so an index can verify vector-space identity. Calls forward `AbortSignal` and providers must honor it.

Providers are registered with effect-scoped disposers, making reloads and tests safe. The seam does not claim semantic quality: that belongs to each provider and model.

## Model Experience

### Request context and condition

#### What the model sees

Nothing directly. Knowledge Consumers may use `ctx.embedding` vectors to select model-visible excerpts, but this service contributes no prompt or tool result.

#### Token effect

Zero direct agent-model tokens. Embedding-provider billing and tokenization belong to the selected provider.

#### KV Cache effect

This service does not alter model-request prefixes or expose a KV cache.

## Known Limitations and Deferred Work

- **Consumer-owned compatibility** — the index Consumer must compare model, revision, and dimensions before comparing vectors.
- **Provider coverage** — retries, remote adapters, provider token accounting, and production quality evaluation remain provider work.
