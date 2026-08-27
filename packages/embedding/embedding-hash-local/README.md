# `@deepseek-ai/dsh-embedding-hash-local`

English | [中文](README.zh.md)

Offline deterministic feature-hashing provider for development and tests. It maps UTF-8 bytes into a configurable positive-integer dimension and L2-normalizes the result. The identity is `feature-hash-v1` plus the configured dimensions.

This is not a semantic embedding model and must not be used to claim production retrieval quality. Load it with `apply(ctx, { id, dimensions })`; registration is effect-scoped and is removed during context teardown.

## Model Experience

### Request context and condition

#### What the model sees

Nothing directly. A Knowledge Consumer may use `feature-hash-v1` vectors to select later context, but this provider contributes no prompt or tool result.

#### Token effect

Zero model tokens; hashing is local CPU work.

#### KV Cache effect

This provider does not alter model-request prefixes or expose a KV cache.

## Known Limitations and Deferred Work

- **No semantic quality** — feature hashing provides deterministic numeric fingerprints, not semantic similarity, and must not be selected for production retrieval quality.
- **Local-only mechanism** — remote inference, billing, retries, and provider health belong to production embedding adapters.
