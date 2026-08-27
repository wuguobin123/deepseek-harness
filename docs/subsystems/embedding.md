# Embedding

English | [中文](embedding.zh.md)

The embedding capability is a provider-neutral `ctx.embedding` service. It separates the Knowledge index from a concrete embedding vendor, keeps cancellation explicit, and makes vector compatibility testable instead of relying on deployment convention.

Source: [`packages/embedding/embedding/src/types.ts`](../../packages/embedding/embedding/src/types.ts)

## EmbeddingIdentity

Every result names the model, revision, and vector dimensions. A Consumer must compare all three fields before mixing stored document vectors with a new query vector. This prevents a model swap or dimension change from silently corrupting ranking.

## EmbeddingResult

The result contains vectors in input order and their shared `EmbeddingIdentity`. The service does not normalize or reinterpret a provider's values.

## EmbeddingProvider

A provider exposes document-batch and single-query operations in one vector space. `available()` is a cheap local configuration check, not a remote health probe. Provider registration is effect-scoped; configured selection is explicit, while implicit selection succeeds only when exactly one provider is usable.

## Local development provider

[`embedding-hash-local`](../../packages/embedding/embedding-hash-local) produces deterministic L2-normalized feature hashes for tests and offline development. It has no semantic retrieval quality and is not a production embedding model.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxembedding--embeddingruntime"></a>

### `ctx.embedding` — `EmbeddingRuntime`

Embedding registry and execution service.

```ts cordis-catalog
/**
 * Register a provider and return its effect-scoped disposer.
 * @param provider - Provider registered under its stable id.
 * @returns Disposer that unregisters this contribution.
 */
registerProvider(provider: EmbeddingProvider): () => void

/**
 * Embed documents through the selected provider.
 * @param documents - Document strings in result-vector order.
 * @param signal - Optional cancellation signal forwarded unchanged.
 * @returns Vectors and their shared vector-space identity.
 */
async embedDocuments(documents: readonly string[], signal?: AbortSignal): Promise<EmbeddingResult>

/**
 * Embed one query through the selected provider.
 * @param query - Query text to embed.
 * @param signal - Optional cancellation signal forwarded unchanged.
 * @returns One vector and its vector-space identity.
 */
async embedQuery(query: string, signal?: AbortSignal): Promise<EmbeddingResult>
```

Source: [`packages/embedding/embedding/src/index.ts`](../../packages/embedding/embedding/src/index.ts)
<!-- END GENERATED cordis-surface -->
