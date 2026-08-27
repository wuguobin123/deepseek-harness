# Agent Note: Tenant-scoped knowledge retrieval seam

Status: implemented

English | [中文](2026-08-25-tenant-scoped-knowledge-retrieval-seam.zh.md)

## Problem

Private knowledge combines authenticated ownership, document ingestion, indexing, retrieval, and model-facing citations. Treating it as an artifact-store feature or a tool-specific vector database would let storage choices dictate the model schema and would make tenant filters optional at alternate call sites.

## Decision

Knowledge retrieval is a capability seam with independent Service Definition, Service Provider, and Consumer packages. `@deepseek-ai/dsh-knowledge` owns `ctx.knowledge`, scoped operation types, provider selection, ingestion byte limits, and stable citation fields. `@deepseek-ai/dsh-knowledge-sqlite-local` owns the local SQLite metadata, FTS5, vector, and ingestion-job implementation. `@deepseek-ai/dsh-tool-knowledge` owns the `knowledge_search` schema, prompt guidance, bounded model output, and replay presentation.

Embedding is a separate capability because vector-space identity and model selection change independently of document storage. `@deepseek-ai/dsh-embedding` returns vectors with model, revision, and dimension identity. `@deepseek-ai/dsh-embedding-hash-local` is a deterministic offline provider for tests and development; it does not claim semantic retrieval quality.

Every knowledge operation receives a trusted `KnowledgeScope` containing both `TenantId` and `KnowledgeSubjectId`. Providers include both values in every ownership lookup and mutation. Unknown or foreign resource identifiers return the same not-found or empty-search result as absent resources. The model never supplies either scope field.

The current Consumer derives a personal-tenant scope from the durable session `ownerId`, using that account identifier as both tenant and subject. A future organization tenancy service may resolve a distinct tenant and membership, but it must still produce the same trusted scope before calling `ctx.knowledge`; organization identifiers do not join the tool schema.

Ingestion accepts an `AsyncIterable<Uint8Array>`. The Service Definition enforces the configured total byte limit while a provider consumes the stream. Providers publish a document revision and its chunks atomically after parsing and embedding succeed; jobs expose queued, running, succeeded, failed, or cancelled state. Citations retain knowledge-base, document, revision, chunk, structured location, content hash, index revision, and score fields.

Retrieved excerpts reach the model only through the ordinary durable `tool/call` and `tool/result` events. The Consumer labels hits `[K1]`, preserves stable locators, tells the model to cite the labels, and states that retrieved text is untrusted data rather than instructions.

## Alternatives considered

**One RAG plugin containing every layer.** This would shorten the initial configuration, but provider replacement, ingestion evolution, and model-facing schema changes would share one release unit. A bundle may install the packages together without collapsing their ownership.

**Reuse artifact or user-context storage.** Artifacts are delivery outputs and user context stores small user-controlled values. Neither owns document revisions, retrieval ranking, per-chunk citations, or tenant-and-subject authorization on every operation.

**Expose tenant identifiers as tool arguments.** A model-selected tenant would turn authorization into prompt behavior. Scope instead comes from authenticated session state and is absent from JSON Schema.

**Create one collection or database per tenant.** Per-tenant physical names complicate lifecycle and can collide after sanitization. Composite tenant and subject columns remain authoritative even when a future backend also uses physical partitions as an optimization.

**Start with graph retrieval.** Graph indexing helps corpus-wide questions but adds indexing cost and new failure modes. The initial provider uses keyword and vector evidence behind the same search contract; graph retrieval can become another provider or routed strategy.

## Consequences

The package split preserves a stable model tool while storage and embedding providers change independently. Tenant isolation is testable at the provider contract and at the model Consumer, and revision identity makes citations and index compatibility traceable.

The initial local provider supports bounded UTF-8 plain text and Markdown in one process. It is not a hosted multi-writer backend, document converter, OCR system, connector framework, or production embedding model. Authenticated upload APIs and organization membership resolution remain outside this seam until their HTTP/RPC principal carrier can supply `KnowledgeScope` without accepting scope from request data.

The keyless test suite covers provider selection, stream bounds, embedding identity, local ingestion and retrieval, stable citations, tool scope derivation, and foreign tenant or subject identifiers. A production backend must pass the same negative isolation cases before it can replace the local provider.
