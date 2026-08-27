# `@deepseek-ai/dsh-knowledge`

English | [中文](README.zh.md)

`KnowledgeRuntime` (`ctx.knowledge`) defines the scoped knowledge capability: knowledge-base management, bounded streaming ingestion, asynchronous ingestion-job status, document deletion, and cited search. It owns provider registration and selection; providers own storage, parsing, indexing, and tenant authorization.

## Service API

`registerProvider(provider)` returns a fiber/HMR-safe disposer and rejects duplicate ids. Each operation receives a trusted `KnowledgeScope` containing both tenant and subject identity, plus an explicit `AbortSignal`. The runtime selects a configured provider, or exactly one usable provider; missing, unavailable, and ambiguous selections throw `KnowledgeError` with open-string machine codes.

`search()` accepts zero or more knowledge-base ids (omitted means all bases available in the scope), forwards a capped `maxResults` to the provider, and truncates any over-returned hits. A hit carries stable knowledge-base, document, revision, chunk, title, structured location, excerpt, content hash, index revision, and score citation fields. `KnowledgeContent` is an `AsyncIterable<Uint8Array>` so ingestion need not buffer an entire document.

The runtime enforces the configured positive `maxIngestBytes` limit before provider invocation when `byteLength` is declared and while the provider consumes every streamed chunk. Exceeding it throws `KNOWLEDGE_CONTENT_TOO_LARGE`. Providers must apply the complete tenant-and-subject scope to reads, writes, search, and deletion; scope is trusted caller data and never a model field.

## Provider and consumer roles

This package is the Service Definition. A provider adapter implements `KnowledgeProvider`; a future tool or application package is the Consumer and owns model-facing schemas, prompts, and citation presentation. The scope is supplied by trusted callers and is deliberately not a model field; providers must enforce it on every operation, including reads and deletes.

## Model Experience

### Request context and condition

#### What the model sees

Nothing directly. A Consumer may render bounded `ctx.knowledge.search()` hits and stable citations while keeping the tenant, subject, and provider credentials outside model-visible fields.

#### Token effect

Zero direct tokens. The Consumer owns any tokens added by retrieved excerpts and citation instructions.

#### KV Cache effect

This service does not alter a model request. A Consumer may append a variable tool result after an already-reusable prefix.

## Known Limitations and Deferred Work

- No built-in parser, storage, authorization policy, embedding model, or index implementation is included.
- Provider availability is a cheap local check; health probing and per-provider diagnostics are deferred.
- The runtime enforces one configured result ceiling and ingest byte ceiling; ranking, filtering, pagination, resumable uploads, and index consistency remain provider responsibilities.
