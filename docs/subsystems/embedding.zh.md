# 嵌入

[English](embedding.md) | 中文

嵌入能力是与提供方无关的 `ctx.embedding` 服务。它把知识索引与具体嵌入厂商分离，显式传递取消信号，并让向量兼容性可以被检查，而不是依赖部署约定。

源码：[`packages/embedding/embedding/src/types.ts`](../../packages/embedding/embedding/src/types.ts)

## EmbeddingIdentity

每个结果都标明模型、修订号和向量维度。Consumer 在混合已存储的文档向量和新查询向量之前，必须比较全部三个字段。这样可以避免模型替换或维度变化无声破坏排序。

## EmbeddingResult

结果按输入顺序包含向量及其共享的 `EmbeddingIdentity`。服务不会归一化或重新解释提供方返回的数值。

## EmbeddingProvider

提供方在同一向量空间中暴露批量文档和单查询操作。`available()` 是低成本本地配置检查，不是远程健康探测。提供方注册受 effect 作用域约束；配置选择是显式的，隐式选择只在恰有一个可用提供方时成功。

## 本地开发提供方

[`embedding-hash-local`](../../packages/embedding/embedding-hash-local) 为测试和离线开发生成确定性的 L2 归一化特征哈希。它不具备语义检索质量，也不是生产嵌入模型。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
