# 租户隔离的知识检索

[English](knowledge.md) | 中文

知识能力包含三个插件角色：[`dsh-knowledge`](../../packages/knowledge/knowledge) 定义 `ctx.knowledge`，[`dsh-knowledge-sqlite-local`](../../packages/knowledge/knowledge-sqlite-local) 提供本地导入和混合检索，[`dsh-tool-knowledge`](../../packages/knowledge/tool-knowledge) 向模型暴露带引用的证据。嵌入是独立 seam，因为嵌入提供方与知识存储会独立演进。

源码：[`packages/knowledge/knowledge/src/types.ts`](../../packages/knowledge/knowledge/src/types.ts)

## KnowledgeScope

每项操作都要求可信调用方提供品牌化租户 id 和品牌化主体 id。模型可见 schema 不含这两个字段。本地提供方把两个值用于每个知识库、文档、任务、分块、全文、向量、删除和查询条件；因此猜测另一个作用域的 id 只会表现为不存在。

MVP Consumer 把已认证会话的 `ownerId` 同时映射到两个值。这一选择先支持个人知识，同时保留未来组织成员关系和委托主体所需的存储键。

## KnowledgeBase 和 KnowledgeBaseInput

知识库在一个作用域内命名。仅有不透明的 `KnowledgeBaseId` 绝不构成授权。

## KnowledgeDocumentInput

导入接收元数据和 `AsyncIterable<Uint8Array>`。`ctx.knowledge` 会在提供方消费流时强制执行配置的字节上限，避免无界的整文件缓冲。本地 MVP 接受 UTF-8 纯文本和 Markdown，创建不可变的修订与分块 id，并且只在处理成功后发布检索行。

## KnowledgeIngestJob 和 KnowledgeIngestJobId

导入表示为状态为 `queued`、`running`、`succeeded`、`failed` 或 `cancelled` 的任务。查询任务必须使用与创建时相同的完整作用域。

## KnowledgeSearchRequest 和 KnowledgeSearchResult

检索可以指定知识库，也可以覆盖作用域内全部可见知识库。显式空知识库列表表示无结果。运行时限制 `maxResults`；只有查询向量的模型、修订号和维度与已存储索引身份一致时，提供方才会组合 FTS5 相关度与余弦相似度。

每项命中都是稳定引用，包含知识库、文档、修订和分块 id、标题、结构化位置、摘录、内容哈希、索引修订和分数。`knowledge_search` 把它们展示为 `[K1]`、`[K2]` 和稳定的 `knowledge://...` 定位符。检索文本是不可信数据，而不是可执行指令。

## KnowledgeProvider

提供方负责持久化、解析、索引、排序和执行所提供作用域。它们必须以事务方式保持状态变更一致，并响应传入的 `AbortSignal`。本地提供方是单进程 MVP；分布式 worker、断点续传、更丰富的解析器、静态加密、生产语义嵌入、评估和组织授权属于后续层。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxknowledge--knowledgeruntime"></a>

### `ctx.knowledge` — `KnowledgeRuntime`

Provider registry and scoped operation facade for `ctx.knowledge`.

```ts cordis-catalog
/**
 * Register a provider under its stable id.
 * @param provider - Scoped knowledge implementation.
 * @returns HMR/fiber disposer that unregisters the provider.
 */
registerProvider(provider: KnowledgeProvider): () => void

/**
 * Create a knowledge base in the caller's scope.
 * @param scope - Trusted tenant and subject scope.
 * @param input - Knowledge-base metadata.
 * @param signal - Cancellation signal forwarded unchanged.
 * @returns The created scoped knowledge base.
 */
async createKnowledgeBase(scope: KnowledgeScope, input: KnowledgeBaseInput, signal: AbortSignal): Promise<KnowledgeBase>

/**
 * List knowledge bases visible in the caller's scope.
 * @param scope - Trusted tenant and subject scope.
 * @param signal - Cancellation signal forwarded unchanged.
 * @returns Knowledge bases visible in the complete scope.
 */
async listKnowledgeBases(scope: KnowledgeScope, signal: AbortSignal): Promise<readonly KnowledgeBase[]>

/**
 * Start document ingestion in the caller's scope.
 * @param scope - Trusted tenant and subject scope.
 * @param input - Streaming document and metadata.
 * @param signal - Cancellation signal forwarded unchanged.
 * @returns The initial asynchronous ingestion job state.
 */
async startIngest(scope: KnowledgeScope, input: KnowledgeDocumentInput, signal: AbortSignal): Promise<KnowledgeIngestJob>

/**
 * Read an ingestion job in the caller's scope.
 * @param scope - Trusted tenant and subject scope.
 * @param jobId - Opaque ingestion job id.
 * @param signal - Cancellation signal forwarded unchanged.
 * @returns Current job state visible in the complete scope.
 */
async getIngestJob(scope: KnowledgeScope, jobId: KnowledgeIngestJobId, signal: AbortSignal): Promise<KnowledgeIngestJob>

/**
 * Search and enforce the configured maximum result count.
 * @param scope - Trusted tenant and subject scope.
 * @param request - Query, optional base selection, and requested bound.
 * @param signal - Cancellation signal forwarded unchanged.
 * @returns Bounded provider-independent citations.
 */
async search(scope: KnowledgeScope, request: KnowledgeSearchRequest, signal: AbortSignal): Promise<KnowledgeSearchResult>

/**
 * Delete a document in the caller's scope.
 * @param scope - Trusted tenant and subject scope.
 * @param documentId - Opaque document id resolved within the scope.
 * @param signal - Cancellation signal forwarded unchanged.
 * @returns Nothing after the scoped deletion completes.
 */
async deleteDocument(scope: KnowledgeScope, documentId: KnowledgeDocumentId, signal: AbortSignal): Promise<void>
```

Source: [`packages/knowledge/knowledge/src/index.ts`](../../packages/knowledge/knowledge/src/index.ts)
<!-- END GENERATED cordis-surface -->
